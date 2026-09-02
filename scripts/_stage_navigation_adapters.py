from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'anchor missing in {path}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1))


def replace_between(path, start, end, replacement):
    p = Path(path)
    text = p.read_text()
    left = text.find(start)
    if left < 0:
        raise SystemExit(f'start anchor missing in {path}: {start!r}')
    right = text.find(end, left + len(start))
    if right < 0:
        raise SystemExit(f'end anchor missing in {path}: {end!r}')
    p.write_text(text[:left] + replacement + text[right:])


# Renderer-neutral controller gains camera-follow plus user-interaction/simulation callbacks.
replace_once(
    'src/spatial-controller.js',
    "    focusPosition: requireAdapterMethod(adapter, 'focusPosition'),\n",
    "    focusPosition: requireAdapterMethod(adapter, 'focusPosition'),\n    followPosition: requireAdapterMethod(adapter, 'followPosition'),\n",
)
replace_once(
    'src/spatial-controller.js',
    "  onSelectFeature,\n  onMapPositionSelect,\n  onLocationError,\n",
    "  onSelectFeature,\n  onMapPositionSelect,\n  onSimulatedPositionChange,\n  onMapInteraction,\n  onLocationError,\n",
)
replace_once(
    'src/spatial-controller.js',
    "        onSelectFeature,\n        onMapPositionSelect,\n      });\n",
    "        onSelectFeature,\n        onMapPositionSelect,\n        onSimulatedPositionChange,\n        onMapInteraction,\n      });\n",
)
replace_once(
    'src/spatial-controller.js',
    "      onSelectPlace,\n      onMapPositionSelect,\n      onLocationError,\n    });\n",
    "      onSelectPlace,\n      onMapPositionSelect,\n      onSimulatedPositionChange,\n      onMapInteraction,\n      onLocationError,\n    });\n",
)

# Leaflet: simulated position is an actual draggable handle; ordinary GPS stays canvas-backed.
replace_once(
    'src/map.js',
    "function popupHtml(node, language) {\n",
    "function simulatedPositionIcon() {\n"
    "  return L.divIcon({\n"
    "    className: 'simulated-position-marker-wrap',\n"
    "    html: '<span class=\"simulated-position-marker\" aria-hidden=\"true\">⌖</span>',\n"
    "    iconSize: [34, 34],\n"
    "    iconAnchor: [17, 17],\n"
    "  });\n"
    "}\n\n"
    "function popupHtml(node, language) {\n",
)
replace_once(
    'src/map.js',
    "export function createLeafletSpatialAdapter(element, graph, world, { language = 'de', onSelectPlace, onMapPositionSelect, onLocationError } = {}) {",
    "export function createLeafletSpatialAdapter(element, graph, world, { language = 'de', onSelectPlace, onMapPositionSelect, onSimulatedPositionChange, onMapInteraction, onLocationError } = {}) {",
)
replace_once(
    'src/map.js',
    "  map.on('click', ({ latlng }) => {\n    if (!Number.isFinite(latlng?.lat) || !Number.isFinite(latlng?.lng)) return;\n    onMapPositionSelect?.({ lat: latlng.lat, lng: latlng.lng });\n  });\n\n",
    "  map.on('click', ({ latlng }) => {\n"
    "    if (!Number.isFinite(latlng?.lat) || !Number.isFinite(latlng?.lng)) return;\n"
    "    onMapPositionSelect?.({ lat: latlng.lat, lng: latlng.lng });\n"
    "  });\n"
    "  map.on('dragstart', () => onMapInteraction?.({ kind: 'pan' }));\n"
    "  const handleWheel = () => onMapInteraction?.({ kind: 'zoom' });\n"
    "  element.addEventListener('wheel', handleWheel, { passive: true });\n\n",
)
replace_between(
    'src/map.js',
    "  function setUserPosition(position) {\n",
    "\n\n  return {",
    "  function setUserPosition(position) {\n"
    "    userLayer.clearLayers();\n"
    "    element.dataset.userPositionRendered = 'false';\n"
    "    if (!Number.isFinite(position?.lat) || !Number.isFinite(position?.lng)) return false;\n"
    "    const latlng = [position.lat, position.lng];\n"
    "    L.circle(latlng, {\n"
    "      radius: Math.min(position.accuracy ?? 0, 150),\n"
    "      className: 'user-accuracy',\n"
    "    }).addTo(userLayer);\n"
    "    if (position.simulated) {\n"
    "      const marker = L.marker(latlng, {\n"
    "        draggable: true,\n"
    "        icon: simulatedPositionIcon(),\n"
    "        title: currentLanguage === 'de' ? 'Simulierte Position ziehen' : 'Drag simulated position',\n"
    "      }).addTo(userLayer);\n"
    "      marker.on('dragstart', () => onMapInteraction?.({ kind: 'position-drag' }));\n"
    "      marker.on('drag', () => {\n"
    "        const next = marker.getLatLng();\n"
    "        onSimulatedPositionChange?.({ lat: next.lat, lng: next.lng, accuracy: 0 }, { final: false });\n"
    "      });\n"
    "      marker.on('dragend', () => {\n"
    "        const next = marker.getLatLng();\n"
    "        onSimulatedPositionChange?.({ lat: next.lat, lng: next.lng, accuracy: 0 }, { final: true });\n"
    "      });\n"
    "    } else {\n"
    "      L.circleMarker(latlng, { radius: 8, className: 'user-location' })\n"
    "        .bindTooltip(currentLanguage === 'de' ? 'Dein Standort' : 'Your location')\n"
    "        .addTo(userLayer);\n"
    "    }\n"
    "    element.dataset.userPositionRendered = 'true';\n"
    "    return true;\n"
    "  }",
)
replace_once(
    'src/map.js',
    "    focusPosition(position, { zoom = null, minZoom = null, duration = 0.35 } = {}) {\n      if (!Number.isFinite(position?.lat) || !Number.isFinite(position?.lng)) return false;\n      const targetZoom = Number.isFinite(zoom)\n        ? zoom\n        : Math.max(map.getZoom(), Number.isFinite(minZoom) ? minZoom : map.getZoom());\n      moveLeafletCamera(map, [position.lat, position.lng], targetZoom, { duration });\n      return true;\n    },\n",
    "    focusPosition(position, { zoom = null, minZoom = null, duration = 0.35 } = {}) {\n"
    "      if (!Number.isFinite(position?.lat) || !Number.isFinite(position?.lng)) return false;\n"
    "      const targetZoom = Number.isFinite(zoom)\n"
    "        ? zoom\n"
    "        : Math.max(map.getZoom(), Number.isFinite(minZoom) ? minZoom : map.getZoom());\n"
    "      moveLeafletCamera(map, [position.lat, position.lng], targetZoom, { duration });\n"
    "      return true;\n"
    "    },\n"
    "    followPosition(position, { minZoom = 17, duration = 0.35 } = {}) {\n"
    "      if (!Number.isFinite(position?.lat) || !Number.isFinite(position?.lng)) return false;\n"
    "      const targetZoom = Math.max(map.getZoom(), Number.isFinite(minZoom) ? minZoom : map.getZoom());\n"
    "      moveLeafletCamera(map, [position.lat, position.lng], targetZoom, { duration });\n"
    "      return true;\n"
    "    },\n",
)
replace_once(
    'src/map.js',
    "    destroy() {\n      activeModelViewer?.destroy();\n      map.remove();\n    },\n",
    "    destroy() {\n      activeModelViewer?.destroy();\n      element.removeEventListener('wheel', handleWheel);\n      map.remove();\n    },\n",
)

# MapLibre: draggable DOM simulation marker, route-aligned follow camera, explicit gesture callback.
replace_once(
    'src/maplibre-map.js',
    "function userData(position) {\n",
    "function userData(position, { includePoint = true } = {}) {\n",
)
replace_once(
    'src/maplibre-map.js',
    "  return featureCollection([accuracyPolygon(position), point]);\n}",
    "  return featureCollection([accuracyPolygon(position), includePoint ? point : null]);\n}",
)
replace_once(
    'src/maplibre-map.js',
    "  onSelectFeature,\n  onMapPositionSelect,\n  fetchFn,\n",
    "  onSelectFeature,\n  onMapPositionSelect,\n  onSimulatedPositionChange,\n  onMapInteraction,\n  fetchFn,\n",
)
replace_once(
    'src/maplibre-map.js',
    "  let userPosition = null;\n",
    "  let userPosition = null;\n  let simulatedPositionMarker = null;\n",
)
replace_once(
    'src/maplibre-map.js',
    "  function syncSources() {\n    if (destroyed) return;\n    syncPlaceMarkers();\n    syncSupplementalSources();\n    sourceSetData(map, 'walking-network', walkingData(walkingNetwork));\n    sourceSetData(map, 'active-route', routeData(activeRoute));\n    sourceSetData(map, 'user-position', userData(userPosition));\n  }\n",
    "  function removeSimulatedPositionMarker() {\n"
    "    simulatedPositionMarker?.remove();\n"
    "    simulatedPositionMarker = null;\n"
    "  }\n\n"
    "  function syncSimulatedPositionMarker() {\n"
    "    if (!userPosition?.simulated || !Number.isFinite(userPosition.lat) || !Number.isFinite(userPosition.lng)) {\n"
    "      removeSimulatedPositionMarker();\n"
    "      return;\n"
    "    }\n"
    "    if (!simulatedPositionMarker) {\n"
    "      const handle = document.createElement('div');\n"
    "      handle.className = 'simulated-position-marker simulated-position-marker--maplibre';\n"
    "      handle.setAttribute('role', 'img');\n"
    "      handle.textContent = '⌖';\n"
    "      handle.title = currentLanguage === 'de' ? 'Simulierte Position ziehen' : 'Drag simulated position';\n"
    "      simulatedPositionMarker = new Marker({ element: handle, draggable: true, anchor: 'center' })\n"
    "        .setLngLat([userPosition.lng, userPosition.lat])\n"
    "        .addTo(map);\n"
    "      simulatedPositionMarker.on('dragstart', () => onMapInteraction?.({ kind: 'position-drag' }));\n"
    "      simulatedPositionMarker.on('drag', () => {\n"
    "        const next = simulatedPositionMarker.getLngLat();\n"
    "        onSimulatedPositionChange?.({ lat: next.lat, lng: next.lng, accuracy: 0 }, { final: false });\n"
    "      });\n"
    "      simulatedPositionMarker.on('dragend', () => {\n"
    "        const next = simulatedPositionMarker.getLngLat();\n"
    "        onSimulatedPositionChange?.({ lat: next.lat, lng: next.lng, accuracy: 0 }, { final: true });\n"
    "      });\n"
    "    } else {\n"
    "      simulatedPositionMarker.setLngLat([userPosition.lng, userPosition.lat]);\n"
    "      simulatedPositionMarker.getElement().title = currentLanguage === 'de' ? 'Simulierte Position ziehen' : 'Drag simulated position';\n"
    "    }\n"
    "  }\n\n"
    "  function syncSources() {\n"
    "    if (destroyed) return;\n"
    "    syncPlaceMarkers();\n"
    "    syncSupplementalSources();\n"
    "    sourceSetData(map, 'walking-network', walkingData(walkingNetwork));\n"
    "    sourceSetData(map, 'active-route', routeData(activeRoute));\n"
    "    sourceSetData(map, 'user-position', userData(userPosition, { includePoint: !userPosition?.simulated }));\n"
    "    syncSimulatedPositionMarker();\n"
    "  }\n",
)
replace_once(
    'src/maplibre-map.js',
    "  map.on('click', (event) => {\n    if (!Number.isFinite(event?.lngLat?.lat) || !Number.isFinite(event?.lngLat?.lng)) return;\n    const interactive = map.queryRenderedFeatures?.(event.point, { layers: sourceLayers }) ?? [];\n    if (interactive.length) return;\n    onMapPositionSelect?.({ lat: event.lngLat.lat, lng: event.lngLat.lng });\n  });\n",
    "  map.on('click', (event) => {\n"
    "    if (!Number.isFinite(event?.lngLat?.lat) || !Number.isFinite(event?.lngLat?.lng)) return;\n"
    "    const interactive = map.queryRenderedFeatures?.(event.point, { layers: sourceLayers }) ?? [];\n"
    "    if (interactive.length) return;\n"
    "    onMapPositionSelect?.({ lat: event.lngLat.lat, lng: event.lngLat.lng });\n"
    "  });\n"
    "  for (const interactionEvent of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) {\n"
    "    map.on(interactionEvent, (event) => {\n"
    "      if (event?.originalEvent) onMapInteraction?.({ kind: interactionEvent });\n"
    "    });\n"
    "  }\n",
)
replace_once(
    'src/maplibre-map.js',
    "    focusPosition(position, { zoom = null, minZoom = null, duration = 0.35 } = {}) {\n      if (!Number.isFinite(position?.lng) || !Number.isFinite(position?.lat)) return false;\n      const targetZoom = Number.isFinite(zoom)\n        ? zoom\n        : Math.max(map.getZoom(), Number.isFinite(minZoom) ? minZoom : map.getZoom());\n      moveMapLibreCamera(map, {\n        center: [position.lng, position.lat],\n        zoom: Math.min(camera.max_zoom, targetZoom),\n        pitch: camera.initial_pitch_deg,\n        bearing: camera.initial_bearing_deg,\n      }, { duration });\n      return true;\n    },\n",
    "    focusPosition(position, { zoom = null, minZoom = null, duration = 0.35 } = {}) {\n"
    "      if (!Number.isFinite(position?.lng) || !Number.isFinite(position?.lat)) return false;\n"
    "      const targetZoom = Number.isFinite(zoom)\n"
    "        ? zoom\n"
    "        : Math.max(map.getZoom(), Number.isFinite(minZoom) ? minZoom : map.getZoom());\n"
    "      moveMapLibreCamera(map, {\n"
    "        center: [position.lng, position.lat],\n"
    "        zoom: Math.min(camera.max_zoom, targetZoom),\n"
    "        pitch: camera.initial_pitch_deg,\n"
    "        bearing: camera.initial_bearing_deg,\n"
    "      }, { duration });\n"
    "      return true;\n"
    "    },\n"
    "    followPosition(position, { minZoom = 17, bearing = null, duration = 0.35 } = {}) {\n"
    "      if (!Number.isFinite(position?.lng) || !Number.isFinite(position?.lat)) return false;\n"
    "      const targetZoom = Math.max(map.getZoom(), Number.isFinite(minZoom) ? minZoom : map.getZoom());\n"
    "      moveMapLibreCamera(map, {\n"
    "        center: [position.lng, position.lat],\n"
    "        zoom: Math.min(camera.max_zoom, targetZoom),\n"
    "        pitch: camera.initial_pitch_deg,\n"
    "        bearing: Number.isFinite(bearing) ? bearing : map.getBearing(),\n"
    "      }, { duration });\n"
    "      return true;\n"
    "    },\n",
)
replace_once(
    'src/maplibre-map.js',
    "    setUserPosition(position) {\n      userPosition = position;\n      const source = map.getSource('user-position');\n      const rendered = Number.isFinite(position?.lat)\n        && Number.isFinite(position?.lng)\n        && Boolean(source && typeof source.setData === 'function');\n      sourceSetData(map, 'user-position', userData(position));\n      element.dataset.userPositionRendered = String(rendered);\n      return rendered;\n    },\n",
    "    setUserPosition(position) {\n"
    "      userPosition = position;\n"
    "      const source = map.getSource('user-position');\n"
    "      const validPosition = Number.isFinite(position?.lat) && Number.isFinite(position?.lng);\n"
    "      sourceSetData(map, 'user-position', userData(position, { includePoint: !position?.simulated }));\n"
    "      syncSimulatedPositionMarker();\n"
    "      const rendered = validPosition && (Boolean(source && typeof source.setData === 'function') || Boolean(simulatedPositionMarker));\n"
    "      element.dataset.userPositionRendered = String(rendered);\n"
    "      return rendered;\n"
    "    },\n",
)
replace_once(
    'src/maplibre-map.js',
    "    setLanguage(nextLanguage) {\n      currentLanguage = nextLanguage;\n      syncPlaceMarkers();\n    },\n",
    "    setLanguage(nextLanguage) {\n      currentLanguage = nextLanguage;\n      syncPlaceMarkers();\n      syncSimulatedPositionMarker();\n    },\n",
)
replace_once(
    'src/maplibre-map.js',
    "      for (const { marker } of placeMarkers.values()) marker.remove();\n      placeMarkers.clear();\n      map.remove();\n",
    "      for (const { marker } of placeMarkers.values()) marker.remove();\n      placeMarkers.clear();\n      removeSimulatedPositionMarker();\n      map.remove();\n",
)

# Shared styling for coherent navigation controls and drag handles.
p = Path('src/styles/app.css')
s = p.read_text()
anchor = ".locate-button.is-active { box-shadow: inset 0 0 0 2px var(--gold); }\n"
if anchor not in s:
    raise SystemExit('navigation CSS anchor missing')
addition = r'''
.navigation-action {
  min-height: 44px;
  padding: .55rem .75rem;
  border: 1px solid rgb(255 255 255 / .2);
  border-radius: .9rem;
  background: #f7f2e5;
  color: var(--forest);
  font-size: .78rem;
  font-weight: 850;
  cursor: pointer;
}
.camera-follow[aria-pressed="true"] { box-shadow: inset 0 0 0 2px var(--gold); }
.simulated-position-marker-wrap { background: transparent; border: 0; }
.simulated-position-marker {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 3px solid white;
  border-radius: 50%;
  background: #236dd1;
  color: white;
  box-shadow: 0 4px 16px rgb(0 0 0 / .3);
  font-size: 1.1rem;
  font-weight: 900;
  line-height: 1;
  cursor: grab;
  touch-action: none;
}
.simulated-position-marker:active { cursor: grabbing; }
'''
s = s.replace(anchor, anchor + addition, 1)
p.write_text(s)
