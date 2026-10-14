# Analysis widget

The Analysis widget provides a map-based project footprint and habitat drawing workflow.

## Features

- Select a map widget in the Builder.
- Draw the project footprint with Polygon, Freehand Polygon, Rectangle, or Circle tools.
- Replace the initial project footprint with its dissolved 300-foot outward buffer.
- Find species from the selected map's feature layer titled `Breeding Sites` whose features intersect the buffered footprint. The layer must expose a `Species` field.
- Choose an analysis option and a species, then draw one or more habitat polygons with the Draw toolbar.
- Clip each suitable habitat drawing to the overlap of the buffered project footprint and matching species' Breeding Sites features; only the overlapping geometry is displayed and measured.
- Show the completed project footprint and species habitat as renderer-backed feature layers in the map Legend. The footprint uses a 25%-opaque black fill; habitat polygons use the matching Breeding Sites symbol color with a bold diagonal crosshatch. Area labels use black text with a 2px white halo and move to uncovered portions of lower-priority polygons, or outside the habitat extents if fully covered.
- Species choices show their Breeding Sites polygon symbols. The selected species name appears in the habitat prompt, and its selected button uses a 15%-opaque species-color background.
- Keep Breeding Sites above habitat drawings, and habitat drawings above the project footprint.
- Review project footprint and habitat areas and perimeters in Tasks. Delete an individual habitat from its task card, or redraw the footprint only before any habitat has been drawn.
- Calculate Harassment results after drawing suitable habitat for each intersecting species. The Results table shows each intersected Breeding Sites feature's Species, MaxPairs, and MeanPairs values, plus the percentage of that feature's area covered by the suitable habitat.
- Use Draw's Clear all action or Redraw project footprint to reset the footprint and dependent habitat drawings.

The widget reports area in square feet and perimeter in feet. Buffering uses the browser ArcGIS geometry API, selecting geodesic buffering for geographic and Web Mercator spatial references and planar buffering for other projected references. Completed graphics are stored in client-side feature layers for the current widget session and are not saved to a service.
