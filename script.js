document.addEventListener('DOMContentLoaded', function () {
    var map = L.map("map").setView([51.45, 14.83], 12);

    // Base layer - OpenStreetMap
    var baseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap"
    }).addTo(map);
    
    // DWD rain radar layer
    var regenradar = L.tileLayer.wms("https://maps.dwd.de/geoproxy/service/", {
        layers: 'RX-Produkt',
        format: 'image/png',
        styles: '',
        transparent: true,
        opacity: 0.6,
        attribution: 'Radarkomposit (RX): &copy; <a href="https://maps.dwd.de/geoserver/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities">DWD</a>'
    });
    
    // RGB Layer
    const rgbLayer = L.tileLayer.wms(
        "http://geo.aerialsurveys.de:8080/geoserver/GGS/wms",
        {
            layers: "GGS:RGB-Ortho",
            format: "image/png",
            transparent: true,
            attribution: '&copy; <a href="https://www.ggs-solutions.eu">GGS Solutions</a>'
        }
    );
    
    // CIR Layer
    const cirLayer = L.tileLayer.wms(
        "http://geo.aerialsurveys.de:8080/geoserver/GGS/wms",
        {
            layers: "GGS:CIR-Ortho",
            format: "image/png",
            transparent: true,
            attribution: '&copy; <a href="https://www.ggs-solutions.eu">GGS Solutions</a>'
        }
    );
    
    // Variable to hold weather warnings layer
    let weatherWarningsLayer;
    
    function fetchWeatherWarnings() {
        const layerName = "dwd:Warnungen_Gemeinden_vereinigt";
        const wfsUrl = `https://maps.dwd.de/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=${layerName}&outputFormat=application/json`;
        console.log("Fetching from:", wfsUrl);
    
        return fetch(wfsUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log("Fetched data:", data);
                if (data.features && data.features.length > 0) {
                    weatherWarningsLayer = L.geoJSON(data, {
                        style: function(feature) {
                            const rgbColor = feature.properties.EC_AREA_COLOR.split(' ');
                            return {
                                color: `rgb(${rgbColor[0]}, ${rgbColor[1]}, ${rgbColor[2]})`,
                                weight: 2,
                                fillOpacity: 0.5
                            };
                        },
                        onEachFeature: function(feature, layer) {
                            layer.bindTooltip(feature.properties.EVENT || "No warning available", {
                                permanent: false,
                                sticky: true
                            });
                            layer.on('click', function() {
                                layer.bindPopup(feature.properties.DESCRIPTION || "No description available").openPopup();
                            });
                        }
                    });
                } else {
                    console.log("No warnings available.");
                }
            })
            .catch(error => {
                console.error("Error fetching WFS data:", error.message || error);
            })
            .finally(() => {
                // Define baseMaps and overlayMaps only after fetching data
                var baseMaps = {
                    "OpenStreetMap": baseLayer
                };
    
                var overlayMaps = {
                    "DWD Rain Radar": regenradar,
                    "RGB Layer": rgbLayer,
                    "CIR Layer": cirLayer
                };
    
                // Add weather warnings layer only if it was created
                if (weatherWarningsLayer) {
                    overlayMaps["Weather Warnings"] = weatherWarningsLayer;
                }
    
                // Add layer control to the map
                L.control.layers(baseMaps, overlayMaps).addTo(map);
            });
    }
    
    // Call the function to fetch weather warnings
    fetchWeatherWarnings();

    const stations = {
        'Brand': L.latLng(51.46543, 14.74487),
        'Rietschen': L.latLng(51.41750, 14.78742),
        'Podrosche': L.latLng(51.46326, 14.93412)
    };

    const towerIcon = L.icon({
        iconUrl: "/backend/UAVTracker/icons/base-station.png", 
        iconSize: [50, 50], 
        iconAnchor: [25, 25], 
        popupAnchor: [0, -32] 
    });

    const fovLayers = {};
    const headings = {};

    Object.keys(stations).forEach(station => {
        const marker = L.marker(stations[station], { icon: towerIcon }).addTo(map);
        marker.bindTooltip(station, { permanent: true, direction: 'top', offset: [0, -10] });

        fovLayers[station] = L.polygon([], {
            color: 'red',
            dashArray: '5, 5' 
        }).addTo(map);
        headings[station] = 37; 
    });

    fetchAndDisplayHeatmap(map);

    map.on('click', async function (e) {
        const clickedPoint = e.latlng;
        await fetchImagesForStations(clickedPoint);
        updateFOV(clickedPoint);
    });

    async function fetchAndDisplayHeatmap(map) {
        try {
            const response = await fetch(`http://zkms.waldwaechter.de:4000/heatmap`);
            const data = await response.json();
            const heatmapLayer = L.heatLayer(data.map(point => [point.lat, point.lon, point.conf]), {
                radius: 25,
                blur: 15,
                maxZoom: 19,
                minOpacity: 0.5,
                gradient: {0.3: 'lime', 0.5: 'yellow', 0.75: 'red'}
            });
            heatmapLayer.addTo(map);
        } catch (error) {
            console.error('Error fetching heatmap data:', error);
        }
    }

    async function fetchImagesForStations(clickedPoint) {
        const brandImagesDiv = document.getElementById('brand-images');
        const riettschenImagesDiv = document.getElementById('rietschen-images');
        const podroscheImagesDiv = document.getElementById('podrosche-images');

        brandImagesDiv.querySelector('.image-container').innerHTML = '';
        riettschenImagesDiv.querySelector('.image-container').innerHTML = '';
        podroscheImagesDiv.querySelector('.image-container').innerHTML = '';

        for (const stationName in stations) {
            const stationLocation = stations[stationName];
            const heading = calculateHeading(clickedPoint, stationLocation);

            // Update the heading for the station
            headings[stationName] = heading;

            const images = await fetchDynamicImages(stationName, heading, false);
            displayImagesForStation(images, stationName, stationName.toLowerCase() + '-images');

            // Update slider to match the heading
            const slider = document.querySelector(`#${stationName.toLowerCase()}-images .heading-slider`);
            const headingValue = document.querySelector(`#${stationName.toLowerCase()}-images .heading-value`);
            slider.value = Math.round(heading * 10);
            headingValue.textContent = (heading).toFixed(1) + '°';

            // Update FOV for this station
            updateFOV(clickedPoint);

            // Update images when slider value changes
            slider.addEventListener('input', function () {
                const newHeading = this.value / 10;
                headings[stationName] = newHeading; // Update heading for FOV
                headingValue.textContent = newHeading.toFixed(1) + '°';
                updateFOV(clickedPoint); // Update FOV when slider changes
                
            });

            // Update images when slider value changes
            slider.addEventListener('change', function () {
                const newHeading = this.value / 10;
                headings[stationName] = newHeading; // Update heading for FOV
                headingValue.textContent = newHeading.toFixed(1) + '°';
                fetchDynamicImages(stationName, newHeading, true).then(newImages => {
                    displayImagesForStation(newImages, stationName, stationName.toLowerCase() + '-images');
                    updateFOV(clickedPoint); // Update FOV when slider changes
                });
            });
        }
    }

    function updateFOV(clickedPoint) {
        const fovAngle = 7.5; // Angle in degrees
        const distance = 12000; // Distance in meters

        Object.keys(stations).forEach(stationName => {
            const stationLocation = stations[stationName];
            const heading = headings[stationName]; // Use the heading from the slider
            const fovPoints = getFOVPoints(stationLocation, heading, fovAngle, distance);
            fovLayers[stationName].setLatLngs(fovPoints);
        });
    }

    function getFOVPoints(stationLocation, heading, fovAngle, distance) {
        const fovPoints = [];
        const halfAngle = fovAngle / 2;

        // Convert distance from meters to degrees
        const distanceInDegrees = distance / 111320; 

        // Add the center point (station)
        fovPoints.push(stationLocation);

        // Calculate the two points for the FOV edges
        for (let i = -halfAngle; i <= halfAngle; i += halfAngle) {
            const angleRad = (heading + i) * (Math.PI / 180);

            // Calculate the new latitude
            const newLat = stationLocation.lat + (distanceInDegrees * Math.cos(angleRad));

            // Calculate the new longitude, accounting for latitude
            const newLng = stationLocation.lng + (distanceInDegrees * Math.sin(angleRad) / Math.cos(stationLocation.lat * (Math.PI / 180)));

            const point = {
                lat: newLat,
                lng: newLng
            };
            fovPoints.push(point);
        }

        return fovPoints;
    }


    function calculateHeading(clickedPoint, stationLocation) {
        const lat1 = stationLocation.lat * (Math.PI / 180);
        const lat2 = clickedPoint.lat * (Math.PI / 180);
        const dLon = (clickedPoint.lng - stationLocation.lng) * (Math.PI / 180);

        const x = Math.sin(dLon) * Math.cos(lat2);
        const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        let angle = Math.atan2(x, y) * (180 / Math.PI);
        angle = (angle + 360) % 360; 

        return angle;
    }
    async function fetchDynamicImages(towerName, heading, isSlider) {
        const roundedHeading = Math.round(heading * 10);
        const url = `https://geo.waldwaechter.de/api/cam_api?fwt=${towerName}&cam=RGB&hdg=${roundedHeading}&num=5`;
        console.log(`Fetching images from: ${url}`);
        try {
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return await res.json();
        } catch (error) {
            console.error('Error fetching images:', error);
            return [];
        }
    }
    async function fetchBoundingBoxes(towerName, ms) {
        const response = await fetch(`https://geo.waldwaechter.de/api/det_api?fwt=${towerName}&cam=RGB&ts=${ms}`);
        if (!response.ok) {
            console.error('Error fetching bounding boxes:', response.statusText);
            return [];
        }
        return await response.json();
    }

    async function displayImagesForStation(data, stationName, containerId) {
        const containerDiv = document.getElementById(containerId).querySelector('.image-container');

        while (containerDiv.firstChild) {
            containerDiv.removeChild(containerDiv.firstChild);
        }

        if (!data || data.length === 0) {
            console.error(`No image data available for ${stationName}.`);
            return;
        }

        data.forEach(async imageData => {
            const fullPath = `https://zkms.waldwaechter.de/fwt/archive${imageData.path1}${imageData.path2}${imageData.thumb}/${imageData.file}`;
            const imgElement = document.createElement('img');
            imgElement.src = fullPath;
            imgElement.alt = `${stationName} image`;

            const wrapperDiv = document.createElement('div');
            wrapperDiv.style.position = 'relative';

            // Create the anchor element
            const anchorElement = document.createElement('a');
            anchorElement.href = `https://zkms.waldwaechter.de/fwt/archive${imageData.path1}${imageData.path2}/${imageData.fullfile}`; 
            anchorElement.target = '_blank'; // Opens the link in a new tab (optional)
    
            // Wrap the image with the anchor
            anchorElement.appendChild(imgElement);
            wrapperDiv.appendChild(anchorElement);
            containerDiv.appendChild(wrapperDiv);


            imgElement.onload = async () => {
                const boundingBoxes = await fetchBoundingBoxes(stationName, imageData.file);
                boundingBoxes.forEach(box => drawBoundingBoxesOnImage(wrapperDiv, box));
            };
        });
    }

    function drawBoundingBoxesOnImage(wrapperDiv, detection) {
        if (!detection || !detection["center_x"] || !detection["center_y"] || !detection["width"] || !detection["height"] || !detection["confidence"]) {
            console.error('Invalid detection data, skipping bounding box drawing.');
            return;
        }

        const { "center_x": center_x, "center_y": center_y, "width": width, "height": height, "confidence": confidence } = detection;
        const img = wrapperDiv.querySelector('img');
        const imgWidth = img.offsetWidth;
        const imgHeight = img.offsetHeight;

        const boundingBoxDiv = document.createElement('div');
        boundingBoxDiv.classList.add('bounding-box');
        boundingBoxDiv.style.position = 'absolute';
        boundingBoxDiv.style.border = '2px solid red'; 
        boundingBoxDiv.style.width = `${width * imgWidth}px`;
        boundingBoxDiv.style.height = `${height * imgHeight}px`;
        boundingBoxDiv.style.left = `${(center_x - width / 2) * imgWidth}px`;
        boundingBoxDiv.style.top = `${(center_y - height / 2) * imgHeight}px`;
        boundingBoxDiv.textContent = `Confidence: ${confidence.toFixed(2)}`;
        boundingBoxDiv.style.color = 'white';
        boundingBoxDiv.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        boundingBoxDiv.style.padding = '4px';
        boundingBoxDiv.style.fontWeight = 'bold';
        boundingBoxDiv.style.fontSize = '12px';
        boundingBoxDiv.style.fontFamily = 'Arial, sans-serif';

        wrapperDiv.appendChild(boundingBoxDiv);
    }
});