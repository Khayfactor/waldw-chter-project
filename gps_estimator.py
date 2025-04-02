#GNSS position estimator by Roman Natarov, IHP GmbH
import math
from geopy.distance import geodesic
from geopy.point import Point

fov_h_cam = 7.9  # field of view of the camera in degrees, horisontal
fov_v_cam = 10.8  # true field of view of the camera in degrees, vertical
image_width = 752  # width of the image in pixels
image_height = 1028  # height of the image in pixels
Ri_gps = (51.41749279060269, 14.787411134532755)
Br_gps = (51.46537829329922, 14.744853171643255)
Po_gps = (51.46326, 14.93412)
MAX_intersection_dist = 30 #in km

#calculate distance to the horizon  by given altitude, simplified spherical model, return metres
def horizon_distance(cam_altitude):
    return 3.56972 * 1000 * math.sqrt(cam_altitude) #in metres

def intersection_point(hdg_Ri, hdg_Br):
    """
    Calculate the intersection point of two geodesic lines given a start point and bearing for each line.
    :param hdg_Ri: initial bearing (degrees) of the first FWT.
    :param hdg_Br: initial bearing (degrees) of the second FWT.
    :return: Point with the GPS coordinates of the intersection point.
    """
    lat1, lon1 = map(math.radians, Ri_gps)
    lat2, lon2 = map(math.radians, Br_gps)
    hdg_Ri = math.radians(hdg_Ri)
    hdg_Br = math.radians(hdg_Br)
    
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1

    # Angular distance between the two start points
    d12 = 2 * math.asin(math.sqrt(math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2))

    if d12 == 0:
        return None  # Points are the same

    # Initial bearings from start1 to start2 and from start2 to start1
    theta1 = math.acos((math.sin(lat2) - math.sin(lat1) * math.cos(d12)) / (math.sin(d12) * math.cos(lat1)))
    theta2 = math.acos((math.sin(lat1) - math.sin(lat2) * math.cos(d12)) / (math.sin(d12) * math.cos(lat2)))

    if math.sin(lon2 - lon1) > 0:
        theta12 = theta1
        theta21 = 2 * math.pi - theta2
    else:
        theta12 = 2 * math.pi - theta1
        theta21 = theta2

    alpha1 = (hdg_Ri - theta12 + math.pi) % (2 * math.pi) - math.pi
    alpha2 = (theta21 - hdg_Br + math.pi) % (2 * math.pi) - math.pi

    if math.sin(alpha1) == 0 and math.sin(alpha2) == 0:
        return None  # Bearings are parallel

    if math.sin(alpha1) * math.sin(alpha2) < 0:
        return None  # Bearings do not intersect

    alpha3 = math.acos(-math.cos(alpha1) * math.cos(alpha2) + math.sin(alpha1) * math.sin(alpha2) * math.cos(d12))

    d13 = math.atan2(math.sin(d12) * math.sin(alpha1) * math.sin(alpha2), math.cos(alpha2) + math.cos(alpha1) * math.cos(alpha3))

    lat3 = math.asin(math.sin(lat1) * math.cos(d13) + math.cos(lat1) * math.sin(d13) * math.cos(hdg_Ri))
    delta_lon13 = math.atan2(math.sin(hdg_Ri) * math.sin(d13) * math.cos(lat1), math.cos(d13) - math.sin(lat1) * math.sin(lat3))

    lon3 = lon1 + delta_lon13
    lon3 = (lon3 + 3 * math.pi) % (2 * math.pi) - math.pi  # Normalize to -180...+180

    lat3 = math.degrees(lat3)
    lon3 = math.degrees(lon3)
    if lat3 < 0 or lon3 < 0:
        print ("No intersection")
        return None
    max_dist = geodesic(Ri_gps, (lat3, lon3)).km
    if max_dist > MAX_intersection_dist: #in km
        print ("Dist {:02f} km exceeded".format(max_dist))
        return None
    return Point(lat3, lon3)

def calculate_gps(camera_gps, altitude, heading, fov_h, fov_v, tilt, image_width, image_height, x, y):
    # Convert heading to radians
    heading_rad = math.radians(heading)
    tilt_rad = math.radians(tilt)
    
    #calculate absolute coordinates on the image
    y = 1-y #with this y counted from bottom of the image, x - from left fringe
    x = x * image_width
    y = y * image_height
    
    # Calculate the angle offset from the center of the image
    center_x = image_width / 2
    center_y = image_height / 2
    angle_x = (x - center_x) / center_x * (fov_h / 2)
    angle_y = (y - center_y) / center_y * (fov_v / 2)
    
    # Convert angles to radians
    angle_x_rad = math.radians(angle_x)
    angle_y_rad = math.radians(angle_y)
    
    # Adjust the vertical angle by the tilt angle
    total_vertical_angle_rad = angle_y_rad + tilt_rad
    #print("Total vert. angle, rad: ", total_vertical_angle_rad)
    max_distance = horizon_distance(altitude)
    if total_vertical_angle_rad <= 0: #bypass for div/0 here
        #print (" >> Beyond the horizon!")
        distance = max_distance    
    else:
        # Calculate the distance on the ground from the camera to the detected object
        distance = altitude / math.tan(total_vertical_angle_rad)
    if distance > max_distance: #fix for 200km sectors
        #print (" >> Beyond the horizon!")
        distance = max_distance
    #print("Distance to obj. %.0f m" % distance)
    
    # Calculate the bearing from the camera to the detected object
    bearing = heading_rad + angle_x_rad
    
    # Convert bearing back to degrees
    bearing_deg = math.degrees(bearing)
    
    # Calculate the destination point given the starting point, bearing, and distance
    camera_lat, camera_lon = camera_gps
    destination = geodesic(kilometers=distance / 1000).destination((camera_lat, camera_lon), bearing_deg)
    
    return destination.latitude, destination.longitude

#### Entry function, returns coordinates according to the parameters of the FWT
#### parameters:
# fwt: a letter, 'R' for Rietschen, 'B'=Brand
# current heading of the camera in degrees
# x, y - center of the detected area, as saved in the database
def FWT_wrapper(fwt, heading, image_width, image_height, x, y):
    if fwt=='R': #for FWT Rietschen
        camera_gps = Ri_gps
        altitude = 37 #in metres
        tilt = 4.1  # tilt angle of the camera in degrees
    elif fwt=='B': #for FWT Brand
        camera_gps = Br_gps
        altitude = 27 #in metres
        tilt = 3.66  # tilt angle of the camera in degrees
    elif fwt=='P': #for FWT Podrosche
        camera_gps = Po_gps
        altitude = 32 #in metres
        tilt = 1.00  # tilt angle of the camera in degrees <<<<<<<<<<< prove !!!!!!
    else:
        print("Parameter failure, exiting.")
        return (-1.0, -1.0) #should be float, otherwise field in the DB would be int and float simultaneously
    #using 1-y: counted from top of the image, like saved in the database
    return calculate_gps(camera_gps, altitude, heading, fov_h_cam, fov_v_cam, tilt, image_width, image_height, x, 1-y)

def FullProcessor(fwt, heading, image_width, image_height, x, y, width, height):
    print(FWT_wrapper(fwt, heading, image_width, image_height, x-width/2, y-height/2)) #bottom left
    print(FWT_wrapper(fwt, heading, image_width, image_height, x-width/2, y+height/2)) #top left
    print(FWT_wrapper(fwt, heading, image_width, image_height, x+width/2, y+height/2)) #top right
    print(FWT_wrapper(fwt, heading, image_width, image_height, x+width/2, y-height/2)) #bottom right

# Example usage
#x = 0.58  # X coordinate of the detected object in the image
#y = 0.123
#width = 0.08
#height = 0.0287

#object_gps = calculate_gps(camera_gps, altitude, heading, fov_h, fov_v, tilt, image_width, image_height, x, 1-y)
#object_gps = FWT_wrapper('r', heading, image_width, image_height, x, y)
#FullProcessor('R', heading, image_width, image_height, x, y, width, height)

#print(f"Detected object GPS coordinates: {object_gps}")
print(" > gps_estimator module loaded")