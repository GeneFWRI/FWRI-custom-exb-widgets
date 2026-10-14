import { React, jsx, css, hooks, type AllWidgetProps } from 'jimu-core'
import { JimuMapViewComponent, type JimuMapView, loadArcGISJSAPIModules } from 'jimu-arcgis'
import { JimuDraw, JimuDrawCreationMode, type JimuDrawCreatedDescriptor, type JimuDrawVisibleElements } from 'jimu-ui/advanced/map'
import { Paper, WidgetPlaceholder } from 'jimu-ui'
import type * as GeometryEngine from 'esri/geometry/geometryEngine'
import type Polygon from 'esri/geometry/Polygon'
import type SimpleFillSymbol from 'esri/symbols/SimpleFillSymbol'
import type FeatureLayer from 'esri/layers/FeatureLayer'
import type GraphicsLayer from 'esri/layers/GraphicsLayer'
import type UniqueValueRenderer from 'esri/renderers/UniqueValueRenderer'
import type Graphic from 'esri/Graphic'
import type Point from 'esri/geometry/Point'
import type TextSymbol from 'esri/symbols/TextSymbol'
import type { execute as executeLabelPoint } from 'esri/geometry/operators/labelPointOperator'
import type { Config, AnalysisTab } from '../config'
import defaultMessages from './translations/default'
import widgetIcon from '../../icon.svg'

interface LabelPointOperatorModule {
  execute: typeof executeLabelPoint
}

type AnalysisDrawMode = 'polygon' | 'rectangle' | 'circle' | 'freehandPolygon'
type AnalysisOption = 'harassment' | 'habitatModification'
type AnalysisFeatureType = 'footprint' | 'habitat'

interface AnalysisFeature {
  id: string
  objectId?: number
  name: string
  type: AnalysisFeatureType
  species?: string
  area: number
  perimeter: number
  geometry?: Polygon
}

interface SpeciesChoice {
  name: string
  symbol: __esri.SimpleFillSymbol
  geometries: Polygon[]
  records: BreedingSiteRecord[]
}

interface BreedingSiteRecord {
  species: string
  geometry: Polygon
  maxPairs: string | number | null
  meanPairs: string | number | null
}

interface HarassmentResult {
  id: string
  species: string
  maxPairs: string | number | null
  meanPairs: string | number | null
  proportionImpacted: string
}

interface AnalysisLayers {
  footprint: __esri.FeatureLayer
  habitat: __esri.FeatureLayer
  labels: __esri.GraphicsLayer
}

interface AnalysisArcGISConstructors {
  FeatureLayer: typeof FeatureLayer
  GraphicsLayer: typeof GraphicsLayer
  SimpleFillSymbol: typeof SimpleFillSymbol
  UniqueValueRenderer: typeof UniqueValueRenderer
  Graphic: typeof Graphic
  Polygon: typeof Polygon
  Point: typeof Point
  TextSymbol: typeof TextSymbol
}

const footprintSymbolProperties: __esri.SimpleFillSymbolProperties = {
  style: 'solid',
  color: [0, 0, 0, 0.25],
  outline: { type: 'simple-line', color: [0, 0, 0, 0.8], width: 1 }
}

const findLayerCollection = (
  layers: __esri.Collection<__esri.Layer>,
  target: __esri.Layer
): __esri.Collection<__esri.Layer> | undefined => {
  if (layers.includes(target)) {
    return layers
  }
  for (const layer of layers) {
    if (layer.type === 'group') {
      const parent = findLayerCollection((layer as __esri.GroupLayer).layers, target)
      if (parent) {
        return parent
      }
    }
  }
  return undefined
}

const removePolygonZValues = (polygon: Polygon, PolygonModule: typeof Polygon): Polygon => {
  return new PolygonModule({
    rings: polygon.rings.map(ring => ring.map(point => [point[0], point[1]])),
    spatialReference: polygon.spatialReference,
    hasZ: false,
    hasM: false
  })
}

const formatUSNumber = (value: number): string => {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

const getSpeciesColor = (symbol: __esri.SimpleFillSymbol): __esri.Color => {
  return symbol.outline?.color ?? symbol.color
}

const isAnalysisDrawMode = (mode: string): mode is AnalysisDrawMode => {
  return mode === 'polygon' || mode === 'rectangle' || mode === 'circle' || mode === 'freehandPolygon'
}

const visibleElements: JimuDrawVisibleElements = {
  createTools: {
    point: false,
    polyline: false,
    polygon: true,
    rectangle: true,
    circle: true,
    customText: true,
    freehandPolyline: false,
    freehandPolygon: true
  },
  tooltipsToggle: true
}

function Widget (props: AllWidgetProps<Config>): React.ReactElement {
  const translate = hooks.useTranslation(defaultMessages)
  const [jimuMapView, setJimuMapView] = React.useState<JimuMapView>()
  const [geometryEngine, setGeometryEngine] = React.useState<typeof GeometryEngine>()
  const [labelPointOperator, setLabelPointOperator] = React.useState<LabelPointOperatorModule>()
  const [arcGISConstructors, setArcGISConstructors] = React.useState<AnalysisArcGISConstructors>()
  const [analysisLayers, setAnalysisLayers] = React.useState<AnalysisLayers>()
  const [activeTab, setActiveTab] = React.useState<AnalysisTab>(props.config?.activeTab === 'results' ? 'tasks' : props.config?.activeTab ?? 'tasks')
  const [activeDrawMode, setActiveDrawMode] = React.useState<AnalysisDrawMode>('polygon')
  const [analysisOption, setAnalysisOption] = React.useState<AnalysisOption>('harassment')
  const [drawingHabitatSpecies, setDrawingHabitatSpecies] = React.useState<string>()
  const [breedingSpecies, setBreedingSpecies] = React.useState<SpeciesChoice[]>([])
  const [isLoadingSpecies, setIsLoadingSpecies] = React.useState(false)
  const [features, setFeatures] = React.useState<AnalysisFeature[]>([])
  const [harassmentResults, setHarassmentResults] = React.useState<HarassmentResult[]>([])
  const [resultsCalculated, setResultsCalculated] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const drawDescriptor = React.useRef<JimuDrawCreatedDescriptor>(null)
  const nextFeatureId = React.useRef(1)
  const nextObjectId = React.useRef(1)
  const isClearingRef = React.useRef(false)
  const footprintGeometryRef = React.useRef<Polygon | undefined>(undefined)
  const speciesQueryId = React.useRef(0)
  const mapWidgetId = props.useMapWidgetIds?.[0]
  const getErrorMessage = React.useCallback((value: unknown): string => {
    if (value instanceof Error) {
      return value.message
    }
    if (typeof value === 'string') {
      return value
    }
    if (typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string') {
      return value.message
    }
    return translate('unknownError')
  }, [translate])

  React.useEffect(() => {
    if (props.config?.activeTab) {
      setActiveTab(props.config.activeTab === 'results' ? 'tasks' : props.config.activeTab)
    }
  }, [props.config?.activeTab])

  React.useEffect(() => {
    if (!jimuMapView) {
      return
    }

    let cancelled = false
    loadArcGISJSAPIModules([
      'esri/geometry/geometryEngine',
      'esri/layers/FeatureLayer',
      'esri/layers/GraphicsLayer',
      'esri/symbols/SimpleFillSymbol',
      'esri/renderers/UniqueValueRenderer',
      'esri/Graphic',
      'esri/geometry/Polygon',
      'esri/geometry/Point',
      'esri/symbols/TextSymbol',
      'esri/geometry/operators/labelPointOperator'
    ])
      .then(([engine, FeatureLayerModule, GraphicsLayerModule, SimpleFillSymbolModule, UniqueValueRendererModule, GraphicModule, PolygonModule, PointModule, TextSymbolModule, labelPointOperator]) => {
        if (!cancelled) {
          setGeometryEngine(engine as typeof GeometryEngine)
          const constructors: AnalysisArcGISConstructors = {
            FeatureLayer: FeatureLayerModule as typeof FeatureLayer,
            GraphicsLayer: GraphicsLayerModule as typeof GraphicsLayer,
            SimpleFillSymbol: SimpleFillSymbolModule as typeof SimpleFillSymbol,
            UniqueValueRenderer: UniqueValueRendererModule as typeof UniqueValueRenderer,
            Graphic: GraphicModule as typeof Graphic,
            Polygon: PolygonModule as typeof Polygon,
            Point: PointModule as typeof Point,
            TextSymbol: TextSymbolModule as typeof TextSymbol
          }
          setArcGISConstructors(constructors)
          const map = jimuMapView.view?.map
          if (!map) {
            throw new Error(translate('mapUnavailable'))
          }
          const footprintLayer = new constructors.FeatureLayer({
            title: translate('projectFootprint'),
            geometryType: 'polygon',
            hasZ: false,
            hasM: false,
            spatialReference: jimuMapView.view.spatialReference,
            objectIdField: 'OBJECTID',
            fields: [
              { name: 'OBJECTID', type: 'oid' },
              { name: 'analysisWidgetFeatureId', type: 'string' },
              { name: 'analysisWidgetFeatureType', type: 'string' },
              { name: 'analysisWidgetName', type: 'string' },
              { name: 'analysisWidgetDrawMode', type: 'string' },
              { name: 'analysisWidgetAreaSquareFeet', type: 'double' },
              { name: 'analysisWidgetPerimeterFeet', type: 'double' },
              { name: 'analysisWidgetBufferDistanceFeet', type: 'double' }
            ],
            source: [],
            renderer: { type: 'simple', symbol: { ...footprintSymbolProperties, type: 'simple-fill' } },
            legendEnabled: true
          })
          const habitatLayer = new constructors.FeatureLayer({
            title: translate('speciesHabitat'),
            geometryType: 'polygon',
            hasZ: false,
            hasM: false,
            spatialReference: jimuMapView.view.spatialReference,
            objectIdField: 'OBJECTID',
            fields: [
              { name: 'OBJECTID', type: 'oid' },
              { name: 'analysisWidgetFeatureId', type: 'string' },
              { name: 'analysisWidgetFeatureType', type: 'string' },
              { name: 'analysisWidgetName', type: 'string' },
              { name: 'analysisWidgetDrawMode', type: 'string' },
              { name: 'analysisWidgetSpecies', type: 'string' },
              { name: 'analysisWidgetAnalysisOption', type: 'string' },
              { name: 'analysisWidgetAreaSquareFeet', type: 'double' },
              { name: 'analysisWidgetAreaDisplay', type: 'string' },
              { name: 'analysisWidgetPerimeterFeet', type: 'double' }
            ],
            source: [],
            labelsVisible: false,
            orderBy: [{ field: 'analysisWidgetAreaSquareFeet', order: 'ascending' }],
            renderer: new constructors.UniqueValueRenderer({
              field: 'analysisWidgetSpecies',
              defaultSymbol: {
                type: 'simple-fill',
                style: 'diagonal-cross',
                color: [80, 80, 80, 0.9],
                outline: { type: 'simple-line', color: [80, 80, 80, 0.9], width: 2 }
              },
              uniqueValueInfos: []
            }),
            legendEnabled: true
          })
          habitatLayer.labelsVisible = false
          const labelLayer = new constructors.GraphicsLayer({
            title: translate('habitatAreaLabels'),
            listMode: 'hide'
          })
          map.addMany([footprintLayer, habitatLayer, labelLayer])
          setAnalysisLayers({ footprint: footprintLayer, habitat: habitatLayer, labels: labelLayer })
          setLabelPointOperator(labelPointOperator as LabelPointOperatorModule)
          setError(undefined)
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(`${translate('measurementLoadError')}: ${getErrorMessage(loadError)}`)
        }
      })

    return () => {
      cancelled = true
    }
  }, [getErrorMessage, jimuMapView, translate])

  React.useEffect(() => {
    return () => {
      const map = jimuMapView?.view?.map
      if (map && analysisLayers) {
        findLayerCollection(map.layers, analysisLayers.footprint)?.remove(analysisLayers.footprint)
        findLayerCollection(map.layers, analysisLayers.habitat)?.remove(analysisLayers.habitat)
        findLayerCollection(map.layers, analysisLayers.labels)?.remove(analysisLayers.labels)
      }
    }
  }, [analysisLayers, jimuMapView])

  const makeFeature = React.useCallback((graphic: __esri.Graphic, areaOverride?: number): AnalysisFeature | undefined => {
    if (!geometryEngine || graphic.geometry?.type !== 'polygon') {
      return undefined
    }

    const attributes = graphic.attributes ?? {}
    const featureId = typeof attributes.analysisWidgetFeatureId === 'string' ? attributes.analysisWidgetFeatureId : `${props.id}-${nextFeatureId.current++}`
    const objectId = typeof attributes.OBJECTID === 'number' ? attributes.OBJECTID : undefined
    const featureType: AnalysisFeatureType = attributes.analysisWidgetFeatureType === 'habitat' ? 'habitat' : 'footprint'
    const species = typeof attributes.analysisWidgetSpecies === 'string' ? attributes.analysisWidgetSpecies : undefined
    const name = featureType === 'footprint' ? translate('projectFootprint') : `${species ?? translate('habitat')} ${translate('habitatSuffix')}`
    const polygon = graphic.geometry as Polygon
    const area = Math.abs(geometryEngine.geodesicArea(polygon, 'square-feet'))
    const perimeter = Math.abs(geometryEngine.geodesicLength(polygon, 'feet'))
    const areaDisplay = `${formatUSNumber(area)} sq ft`

    graphic.attributes = {
      ...attributes,
      analysisWidgetFeatureId: featureId,
      analysisWidgetFeatureType: featureType,
      analysisWidgetName: name,
      analysisWidgetAreaSquareFeet: area,
      analysisWidgetAreaDisplay: areaDisplay,
      analysisWidgetPerimeterFeet: perimeter
    }

    return { id: featureId, objectId, name, type: featureType, species, area, perimeter, geometry: polygon }
  }, [geometryEngine, props.id, translate])

  React.useEffect(() => {
    if (!geometryEngine || !labelPointOperator || !arcGISConstructors || !analysisLayers) {
      return
    }

    const habitatFeatures = features
      .filter((feature): feature is AnalysisFeature & { geometry: Polygon } => feature.type === 'habitat' && feature.geometry !== undefined)
      .sort((first, second) => first.area - second.area)
    const placements: Array<{ feature: AnalysisFeature & { geometry: Polygon }, geometry?: Polygon }> = []
    const precedingGeometries: Polygon[] = []
    const allExtents = habitatFeatures.map(feature => feature.geometry.extent).filter((extent): extent is __esri.Extent => !!extent)
    const outsideX = allExtents.length ? Math.max(...allExtents.map(extent => extent.xmax)) : 0
    const minY = allExtents.length ? Math.min(...allExtents.map(extent => extent.ymin)) : 0
    const maxY = allExtents.length ? Math.max(...allExtents.map(extent => extent.ymax)) : 0
    const habitatWidth = allExtents.length
      ? outsideX - Math.min(...allExtents.map(extent => extent.xmin))
      : 0
    const outsideOffset = allExtents.length
      ? Math.max((jimuMapView?.view?.resolution ?? habitatWidth * 0.001) * 16, habitatWidth * 0.02, Number.EPSILON)
      : 0

    try {
      for (const feature of habitatFeatures) {
        let labelGeometry: Polygon | undefined = feature.geometry
        if (precedingGeometries.length) {
          const coveredGeometry = precedingGeometries.length === 1
            ? precedingGeometries[0]
            : geometryEngine.union(precedingGeometries)
          const remainingGeometry = geometryEngine.difference(feature.geometry, coveredGeometry)
          const remainingParts = (Array.isArray(remainingGeometry) ? remainingGeometry : remainingGeometry ? [remainingGeometry] : [])
            .filter((geometry): geometry is Polygon => geometry.type === 'polygon')
          if (remainingParts.length) {
            labelGeometry = remainingParts.reduce((largest, current) => {
              return Math.abs(geometryEngine.geodesicArea(current, 'square-feet')) > Math.abs(geometryEngine.geodesicArea(largest, 'square-feet')) ? current : largest
            })
          } else {
            labelGeometry = undefined
          }
        }
        placements.push({ feature, geometry: labelGeometry })
        precedingGeometries.push(feature.geometry)
      }

      const outsideCount = placements.filter(placement => !placement.geometry).length
      let outsideIndex = 0
      const labels = placements.map(({ feature, geometry }) => {
        const placeOutside = geometry === undefined
        const point = placeOutside
          ? new arcGISConstructors.Point({
              x: outsideX + outsideOffset,
              y: maxY > minY
                ? maxY - ((outsideIndex + 1) / (outsideCount + 1)) * (maxY - minY)
                : minY + outsideOffset * (outsideIndex + 1),
              spatialReference: feature.geometry.spatialReference
            })
          : labelPointOperator.execute(geometry)
        if (placeOutside) outsideIndex++
        const textSymbol = new arcGISConstructors.TextSymbol({
          text: `${formatUSNumber(feature.area)} sq ft`,
          color: 'black',
          haloColor: 'white',
          haloSize: '2px',
          horizontalAlignment: placeOutside ? 'left' : 'center',
          verticalAlignment: 'middle',
          font: { family: 'Arial', size: 8, weight: 'normal' }
        })
        return new arcGISConstructors.Graphic({
          geometry: point,
          symbol: textSymbol,
          attributes: {
            analysisWidgetFeatureId: feature.id,
            analysisWidgetFeatureType: 'habitat-label'
          }
        })
      })
      analysisLayers.labels.graphics.removeAll()
      analysisLayers.labels.graphics.addMany(labels)
    } catch (labelError) {
      analysisLayers.labels.graphics.removeAll()
      setError(`${translate('habitatLabelError')}: ${getErrorMessage(labelError)}`)
    }
  }, [analysisLayers, arcGISConstructors, features, geometryEngine, getErrorMessage, jimuMapView, labelPointOperator, translate])

  const getBreedingSpecies = React.useCallback(async (footprint: Polygon): Promise<SpeciesChoice[]> => {
    const map = jimuMapView?.view?.map
    if (!map || !analysisLayers || !arcGISConstructors) {
      throw new Error(translate('mapUnavailable'))
    }

    const layer = map.allLayers.find(candidate => candidate.title?.trim().toLowerCase() === 'breeding sites')
    if (!layer || layer.type !== 'feature') {
      throw new Error(translate('breedingSitesLayerMissing'))
    }
    const breedingLayer = layer as __esri.FeatureLayer
    const siblings = findLayerCollection(map.layers, breedingLayer)
    if (!siblings) {
      throw new Error(translate('breedingSitesLayerMissing'))
    }
    findLayerCollection(map.layers, analysisLayers.footprint)?.remove(analysisLayers.footprint)
    findLayerCollection(map.layers, analysisLayers.habitat)?.remove(analysisLayers.habitat)
    map.layers.add(analysisLayers.footprint, 0)
    const breedingIndex = siblings.indexOf(breedingLayer)
    siblings.add(analysisLayers.habitat, breedingIndex)

    const results = await breedingLayer.queryFeatures({
      geometry: footprint,
      spatialRelationship: 'intersects',
      outSpatialReference: footprint.spatialReference,
      outFields: ['*'],
      returnGeometry: true,
      where: 'Species IS NOT NULL'
    })
    const speciesByName = new Map<string, SpeciesChoice>()
    for (const feature of results.features) {
      const speciesField = Object.keys(feature.attributes ?? {}).find(field => field.toLowerCase() === 'species')
      const value = speciesField ? feature.attributes[speciesField] : undefined
      if (typeof value !== 'string' || value.trim().length === 0 || feature.geometry?.type !== 'polygon') {
        continue
      }

      const name = value.trim()
      const recordGeometry = removePolygonZValues(feature.geometry as Polygon, arcGISConstructors.Polygon)
      const attributes = feature.attributes ?? {}
      const getNumericOrTextField = (fieldName: string): string | number | null => {
        const field = Object.keys(attributes).find(attribute => attribute.toLowerCase() === fieldName.toLowerCase())
        const fieldValue = field ? attributes[field] : undefined
        return typeof fieldValue === 'string' || typeof fieldValue === 'number'
          ? fieldValue
          : fieldValue == null
            ? null
            : String(fieldValue)
      }
      const record: BreedingSiteRecord = {
        species: value,
        geometry: recordGeometry,
        maxPairs: getNumericOrTextField('MaxPairs'),
        meanPairs: getNumericOrTextField('MeanPairs')
      }
      const existingChoice = speciesByName.get(name)
      if (existingChoice) {
        existingChoice.geometries.push(recordGeometry)
        existingChoice.records.push(record)
        continue
      }

      let sourceSymbol: __esri.Symbol | null | undefined
      if (breedingLayer.renderer?.type === 'unique-value') {
        const info = await (breedingLayer.renderer as __esri.UniqueValueRenderer).getUniqueValueInfo(feature)
        sourceSymbol = info.symbol
      } else if (breedingLayer.renderer?.type === 'simple') {
        sourceSymbol = (breedingLayer.renderer as __esri.SimpleRenderer).symbol
      }
      if (sourceSymbol?.type !== 'simple-fill') {
        throw new Error(translate('speciesSymbolUnavailable'))
      }
      speciesByName.set(value.trim(), {
        name,
        symbol: (sourceSymbol as __esri.SimpleFillSymbol).clone(),
        geometries: [recordGeometry],
        records: [record]
      })
    }

    const species = Array.from(speciesByName.values()).sort((first, second) => first.name.localeCompare(second.name))
    const habitatRenderer = new arcGISConstructors.UniqueValueRenderer({
      field: 'analysisWidgetSpecies',
      defaultSymbol: {
        type: 'simple-fill',
        style: 'diagonal-cross',
        color: [80, 80, 80, 0.9],
        outline: { type: 'simple-line', color: [80, 80, 80, 0.9], width: 2 }
      },
      uniqueValueInfos: species.map(choice => {
        const symbol = choice.symbol.clone()
        symbol.style = 'diagonal-cross'
        symbol.color = getSpeciesColor(choice.symbol).clone()
        if (symbol.outline) {
          symbol.outline.color = getSpeciesColor(choice.symbol).clone()
          symbol.outline.width = 2
        }
        return { value: choice.name, label: choice.name, symbol }
      })
    })
    analysisLayers.habitat.renderer = habitatRenderer
    return species
  }, [analysisLayers, arcGISConstructors, jimuMapView, translate])

  const handleDrawCreated = React.useCallback((descriptor: JimuDrawCreatedDescriptor) => {
    drawDescriptor.current = descriptor
  }, [])

  const clearAnalysisLayers = React.useCallback(async () => {
    if (!analysisLayers) {
      return
    }
    for (const layer of [analysisLayers.footprint, analysisLayers.habitat]) {
      const objectIds = await layer.queryObjectIds()
      if (objectIds.length) {
        const result = await layer.applyEdits({
          deleteFeatures: objectIds.map(objectId => ({ objectId: Number(objectId) }))
        })
        const failure = result.deleteFeatureResults?.find(edit => edit.error)
        if (failure?.error) {
          throw new Error(getErrorMessage(failure.error))
        }
      }
      if (analysisLayers.habitat.renderer.type === 'unique-value') {
        (analysisLayers.habitat.renderer as __esri.UniqueValueRenderer).uniqueValueInfos = []
      }
    }
  }, [analysisLayers, getErrorMessage])

  const removeTransientGraphic = React.useCallback((graphic: __esri.Graphic) => {
    const layer = drawDescriptor.current?.sketch.layer
    if (layer?.type === 'graphics') {
      layer.remove(graphic)
    } else if (layer?.type === 'map-notes' && graphic.geometry?.type === 'polygon') {
      layer.polygonLayer.remove(graphic)
    }
  }, [])

  const deleteHabitatFeature = React.useCallback(async (feature: AnalysisFeature) => {
    if (!analysisLayers || feature.type !== 'habitat' || !feature.species) {
      setError(translate('deleteHabitatError'))
      return
    }

    try {
      const speciesWhereClause = `analysisWidgetSpecies = '${feature.species.replace(/'/g, "''")}'`
      const matchingObjectIds = await analysisLayers.habitat.queryObjectIds({
        where: speciesWhereClause
      })
      if (!matchingObjectIds?.length || matchingObjectIds.some(objectId => !Number.isFinite(Number(objectId)))) {
        throw new Error(translate('deleteHabitatError'))
      }

      const result = await analysisLayers.habitat.applyEdits({
        deleteFeatures: matchingObjectIds.map(objectId => ({ objectId: Number(objectId) }))
      })
      const deleteResults = result.deleteFeatureResults ?? []
      const failures = deleteResults.filter(edit => edit.error)
      if (failures.length) {
        throw new Error(failures.map(edit => getErrorMessage(edit.error)).join('; '))
      }
      const deletedFeatureIds = new Set([
        ...features
          .filter(candidate => candidate.type === 'habitat' && candidate.species === feature.species)
          .map(candidate => candidate.id)
      ])
      analysisLayers.labels.graphics
        .filter(label => deletedFeatureIds.has(label.attributes?.analysisWidgetFeatureId))
        .forEach(label => { analysisLayers.labels.graphics.remove(label) })
      setFeatures(previous => previous.filter(candidate =>
        !(candidate.type === 'habitat' && candidate.species === feature.species)
      ))
      setHarassmentResults([])
      setResultsCalculated(false)
      setError(undefined)
    } catch (deleteError) {
      setError(`${translate('deleteHabitatError')}: ${getErrorMessage(deleteError)}`)
    }
  }, [analysisLayers, features, getErrorMessage, translate])

  const clearDrawing = React.useCallback(async (): Promise<boolean> => {
    const layer = drawDescriptor.current?.sketch.layer
    if (layer?.type !== 'graphics' && layer?.type !== 'map-notes') {
      setError(translate('clearDrawingError'))
      return false
    }
    isClearingRef.current = true
    if (layer.type === 'graphics') {
      layer.removeAll()
    } else {
      layer.polygonLayer.removeAll()
      layer.polylineLayer.removeAll()
      layer.pointLayer.removeAll()
      layer.multipointLayer.removeAll()
      layer.textLayer.removeAll()
    }
    try {
      await clearAnalysisLayers()
      isClearingRef.current = false
    } catch (clearError) {
      isClearingRef.current = false
      setError(`${translate('clearDrawingError')}: ${getErrorMessage(clearError)}`)
      return false
    }
    return true
  }, [clearAnalysisLayers, getErrorMessage, translate])

  const resetAnalysis = React.useCallback(() => {
    speciesQueryId.current++
    setFeatures([])
    setHarassmentResults([])
    setResultsCalculated(false)
    setActiveTab('tasks')
    setBreedingSpecies([])
    setDrawingHabitatSpecies(undefined)
    setIsLoadingSpecies(false)
    setAnalysisOption('harassment')
    setError(undefined)
    footprintGeometryRef.current = undefined
    nextFeatureId.current = 1
    nextObjectId.current = 1
  }, [])

  const calculateHarassmentResults = React.useCallback(() => {
    if (!geometryEngine || analysisOption !== 'harassment') {
      setError(translate('harassmentResultsError'))
      return
    }

    try {
      const habitatFeatures = features.filter((feature): feature is AnalysisFeature & { geometry: Polygon, species: string } =>
        feature.type === 'habitat' && feature.geometry !== undefined && feature.species !== undefined
      )
      const habitatBySpecies = new Map<string, Polygon[]>()
      habitatFeatures.forEach(feature => {
        const speciesHabitats = habitatBySpecies.get(feature.species) ?? []
        speciesHabitats.push(feature.geometry)
        habitatBySpecies.set(feature.species, speciesHabitats)
      })

      const results: HarassmentResult[] = []
      breedingSpecies.forEach(species => {
        const speciesHabitats = habitatBySpecies.get(species.name)
        if (!speciesHabitats?.length) {
          return
        }
        const allHabitatGeometry = speciesHabitats.length === 1
          ? speciesHabitats[0]
          : geometryEngine.union(speciesHabitats)
        species.records.forEach((record, recordIndex) => {
          const intersection = geometryEngine.intersect(allHabitatGeometry, record.geometry)
          const intersectedPolygons = (Array.isArray(intersection) ? intersection : intersection ? [intersection] : [])
            .filter((geometry): geometry is Polygon => geometry.type === 'polygon')
          const impactedGeometry = intersectedPolygons.length > 1
            ? geometryEngine.union(intersectedPolygons)
            : intersectedPolygons[0]
          if (!impactedGeometry || impactedGeometry.type !== 'polygon') {
            return
          }
          const breedingArea = Math.abs(geometryEngine.geodesicArea(record.geometry, 'square-feet'))
          const impactedArea = Math.abs(geometryEngine.geodesicArea(impactedGeometry as Polygon, 'square-feet'))
          if (breedingArea <= 0 || impactedArea <= 0) {
            return
          }
          const proportionPercent = Math.round((impactedArea / breedingArea) * 1000) / 10
          results.push({
            id: `${species.name}-${recordIndex}`,
            species: record.species,
            maxPairs: record.maxPairs,
            meanPairs: record.meanPairs,
            proportionImpacted: `${proportionPercent.toFixed(1)}%`
          })
        })
      })

      setHarassmentResults(results)
      setResultsCalculated(true)
      setActiveTab('results')
      setError(undefined)
    } catch (calculationError) {
      setError(`${translate('harassmentResultsError')}: ${getErrorMessage(calculationError)}`)
    }
  }, [analysisOption, breedingSpecies, features, geometryEngine, getErrorMessage, translate])

  const handleDrawingFinished = React.useCallback(async (graphic: __esri.Graphic) => {
    setError(undefined)
    try {
      if (graphic.geometry?.type !== 'polygon') {
        return
      }

      if (!geometryEngine) {
        throw new Error(translate('measurementToolsUnavailable'))
      }
      if (!analysisLayers || !arcGISConstructors) {
        throw new Error(translate('mapUnavailable'))
      }

      const inputGeometry = graphic.geometry as Polygon
      const attributes = graphic.attributes ?? {}
      const featureId = `${props.id}-${nextFeatureId.current++}`
      if (drawingHabitatSpecies) {
        const species = breedingSpecies.find(choice => choice.name === drawingHabitatSpecies)
        if (!species || !analysisLayers || !arcGISConstructors) {
          throw new Error(translate('speciesSymbolUnavailable'))
        }
        const habitatGeometry = removePolygonZValues(inputGeometry, arcGISConstructors.Polygon)
        const footprintGeometry = footprintGeometryRef.current
        if (!footprintGeometry) {
          throw new Error(translate('projectFootprintUnavailable'))
        }
        const correspondingBreedingGeometry = species.geometries.length === 1
          ? species.geometries[0]
          : geometryEngine.union(species.geometries)
        const habitatIntersection = geometryEngine.intersect(habitatGeometry, footprintGeometry)
        const habitatWithinFootprint = Array.isArray(habitatIntersection)
          ? habitatIntersection.length ? geometryEngine.union(habitatIntersection) : null
          : habitatIntersection
        const speciesIntersection = geometryEngine.intersect(correspondingBreedingGeometry, footprintGeometry)
        const speciesWithinFootprint = Array.isArray(speciesIntersection)
          ? speciesIntersection.length ? geometryEngine.union(speciesIntersection) : null
          : speciesIntersection
        const clippedResult = habitatWithinFootprint && speciesWithinFootprint
          ? geometryEngine.intersect(habitatWithinFootprint, speciesWithinFootprint)
          : null
        const clippedPolygons = (Array.isArray(clippedResult) ? clippedResult : clippedResult ? [clippedResult] : [])
          .filter((geometry): geometry is Polygon => geometry.type === 'polygon')
        const clippedUnion = clippedPolygons.length > 1 ? geometryEngine.union(clippedPolygons) : clippedPolygons[0]
        if (!clippedUnion || clippedUnion.type !== 'polygon') {
          removeTransientGraphic(graphic)
          setError(translate('habitatNoOverlap'))
          return
        }
        const clippedHabitatGeometry = removePolygonZValues(clippedUnion as Polygon, arcGISConstructors.Polygon)
        const habitatSymbol = species.symbol.clone()
        habitatSymbol.style = 'diagonal-cross'
        habitatSymbol.color = getSpeciesColor(species.symbol).clone()
        if (habitatSymbol.outline) {
          habitatSymbol.outline.color = getSpeciesColor(species.symbol).clone()
          habitatSymbol.outline.width = 2
        }
        const objectId = nextObjectId.current++
        graphic.attributes = {
          ...attributes,
          OBJECTID: objectId,
          analysisWidgetFeatureId: featureId,
          analysisWidgetFeatureType: 'habitat',
          analysisWidgetDrawMode: activeDrawMode,
          analysisWidgetSpecies: drawingHabitatSpecies,
          analysisWidgetAnalysisOption: analysisOption
        }
        graphic.geometry = clippedHabitatGeometry
        graphic.symbol = habitatSymbol

        const habitatFeature = makeFeature(graphic)
        if (habitatFeature) {
          const result = await analysisLayers.habitat.applyEdits({
            addFeatures: [new arcGISConstructors.Graphic({
              geometry: graphic.geometry,
              attributes: graphic.attributes
            })]
          })
          const failure = result.addFeatureResults?.find(edit => edit.error)
          if (failure?.error) {
            throw new Error(getErrorMessage(failure.error))
          }
          removeTransientGraphic(graphic)
          setFeatures(previous => [habitatFeature, ...previous])
          setHarassmentResults([])
          setResultsCalculated(false)
        }
        return
      }

      const buffer = inputGeometry.spatialReference?.isGeographic || inputGeometry.spatialReference?.isWebMercator
        ? geometryEngine.geodesicBuffer
        : geometryEngine.buffer
      const bufferedGeometry = buffer(inputGeometry, 300, 'feet', true)
      const bufferedOutput = Array.isArray(bufferedGeometry) ? geometryEngine.union(bufferedGeometry) : bufferedGeometry
      if (bufferedOutput?.type !== 'polygon') {
        throw new Error(translate('bufferNoPolygon'))
      }
      const outputGeometry = removePolygonZValues(bufferedOutput as Polygon, arcGISConstructors.Polygon)

      graphic.geometry = outputGeometry
      graphic.symbol = new arcGISConstructors.SimpleFillSymbol(footprintSymbolProperties)
      const objectId = nextObjectId.current++
      graphic.attributes = {
        ...attributes,
        OBJECTID: objectId,
        analysisWidgetFeatureId: featureId,
        analysisWidgetFeatureType: 'footprint',
        analysisWidgetDrawMode: activeDrawMode,
        analysisWidgetBufferDistanceFeet: 300
      }

      const footprintFeature = makeFeature(graphic)
      if (footprintFeature) {
        const result = await analysisLayers.footprint.applyEdits({
          addFeatures: [new arcGISConstructors.Graphic({
            geometry: graphic.geometry,
            attributes: graphic.attributes
          })]
        })
        const failure = result.addFeatureResults?.find(edit => edit.error)
        if (failure?.error) {
          throw new Error(getErrorMessage(failure.error))
        }
        removeTransientGraphic(graphic)
        footprintGeometryRef.current = outputGeometry
        setFeatures(previous => [footprintFeature, ...previous.filter(feature => feature.type !== 'footprint')])
        setDrawingHabitatSpecies(undefined)
        setBreedingSpecies([])
        setIsLoadingSpecies(true)
        const queryId = ++speciesQueryId.current
        try {
          const species = await getBreedingSpecies(outputGeometry as Polygon)
          if (queryId === speciesQueryId.current) {
            setBreedingSpecies(species)
          }
        } catch (speciesError) {
          if (queryId === speciesQueryId.current) {
            setError(`${translate('speciesQueryError')}: ${getErrorMessage(speciesError)}`)
          }
        } finally {
          if (queryId === speciesQueryId.current) {
            setIsLoadingSpecies(false)
          }
        }
      }
    } catch (measurementError) {
      const errorLabel = drawingHabitatSpecies ? 'habitatDrawingError' : 'footprintDrawingError'
      setError(`${translate(errorLabel)}: ${getErrorMessage(measurementError)}`)
    }
  }, [activeDrawMode, analysisLayers, analysisOption, arcGISConstructors, breedingSpecies, drawingHabitatSpecies, geometryEngine, getBreedingSpecies, getErrorMessage, makeFeature, props.id, removeTransientGraphic, translate])

  const handleDrawingCleared = React.useCallback(() => {
    if (isClearingRef.current) {
      return
    }
    clearAnalysisLayers()
      .then(resetAnalysis)
      .catch(clearError => {
        setError(`${translate('clearDrawingError')}: ${getErrorMessage(clearError)}`)
      })
  }, [clearAnalysisLayers, getErrorMessage, resetAnalysis, translate])

  const handleDrawingUpdated = React.useCallback((update: { type: string, graphics: __esri.Graphic[] }) => {
    if (update.type === 'deleted') {
      const removedFootprint = update.graphics.some(graphic => graphic.attributes?.analysisWidgetFeatureType === 'footprint')
      const removedIds = new Set(update.graphics.map(graphic => graphic.attributes?.analysisWidgetFeatureId).filter((id): id is string => typeof id === 'string'))
      setFeatures(previous => removedFootprint ? [] : previous.filter(feature => !removedIds.has(feature.id)))
      if (removedFootprint) {
        footprintGeometryRef.current = undefined
        speciesQueryId.current++
        setBreedingSpecies([])
        setDrawingHabitatSpecies(undefined)
        setIsLoadingSpecies(false)
        setAnalysisOption('harassment')
      }
      return
    }

    if (update.type !== 'modified' && update.type !== 'complete') {
      return
    }

    try {
      const updatedFeatures = update.graphics
        .map(makeFeature)
        .filter((feature): feature is AnalysisFeature => feature !== undefined)
      if (updatedFeatures.length) {
        setFeatures(previous => {
          const byId = new Map(previous.map(feature => [feature.id, feature]))
          updatedFeatures.forEach(feature => byId.set(feature.id, feature))
          return Array.from(byId.values())
        })
      }
    } catch (measurementError) {
      setError(`${translate('measurementError')}: ${getErrorMessage(measurementError)}`)
    }
  }, [getErrorMessage, makeFeature, translate])

  const handleToolsActivated = React.useCallback((mode: string) => {
    if (mode === 'freehand-polygon') {
      setActiveDrawMode('freehandPolygon')
    } else if (isAnalysisDrawMode(mode)) {
      setActiveDrawMode(mode)
    }
  }, [])

  const footprint = features.find(feature => feature.type === 'footprint')
  const habitatFeatures = features.filter(feature => feature.type === 'habitat')
  const hasHabitatForEverySpecies = breedingSpecies.length > 0 &&
    breedingSpecies.every(species => habitatFeatures.some(feature => feature.species === species.name))
  const showDrawingToolbar = !footprint || !!drawingHabitatSpecies
  const tabId = (tab: AnalysisTab): string => `analysis-${props.id}-${tab}-tab`
  const panelId = (tab: AnalysisTab): string => `analysis-${props.id}-${tab}-panel`

  if (!mapWidgetId) {
    return <WidgetPlaceholder icon={widgetIcon} widgetId={props.id} message={translate('selectMap')} />
  }

  return (
    <Paper className='widget-analysis jimu-widget h-100' aria-label={props.label} variant='flat' shape='none'>
      <JimuMapViewComponent useMapWidgetId={mapWidgetId} onActiveViewChange={setJimuMapView} />

      {!jimuMapView
        ? <div style={{ padding: 12 }} role='status'>{translate('loading')}</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', flex: 1, padding: '0 16px 16px', boxSizing: 'border-box' }}>
            <div role='tablist' aria-label={translate('analysisSections')} style={{ display: 'flex', borderBottom: '1px solid var(--sys-color-surface-paper-hint)' }}>
              {(['tasks', 'results'] as AnalysisTab[]).map(tab => (
                <button
                  key={tab}
                  id={tabId(tab)}
                  type='button'
                  role='tab'
                  disabled={tab === 'results' && !resultsCalculated}
                  aria-disabled={tab === 'results' && !resultsCalculated}
                  aria-selected={activeTab === tab}
                  aria-controls={panelId(tab)}
                  onClick={() => {
                    if (tab !== 'results' || resultsCalculated) {
                      setActiveTab(tab)
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    border: 0,
                    borderBottom: activeTab === tab ? '2px solid var(--sys-color-primary-main)' : '2px solid transparent',
                    background: 'transparent',
                    color: activeTab === tab ? 'var(--sys-color-primary-main)' : 'var(--sys-color-surface-paper-text)',
                    cursor: tab === 'results' && !resultsCalculated ? 'not-allowed' : 'pointer',
                    opacity: tab === 'results' && !resultsCalculated ? 0.55 : 1,
                    fontWeight: activeTab === tab ? 600 : 400
                  }}
                >
                  {translate(tab)}
                </button>
              ))}
            </div>

            <section
              id={panelId('tasks')}
              role='tabpanel'
              aria-labelledby={tabId('tasks')}
              hidden={activeTab !== 'tasks'}
              style={{ padding: '12px 10px 0', overflowX: 'hidden', overflowY: 'auto', height: '100%', minHeight: 0, minWidth: 0, flex: 1, boxSizing: 'border-box' }}
            >
              <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>
                {translate(footprint ? 'analysisOptions' : 'drawProjectFootprint')}
              </h2>
              {footprint && (
                <>
                  <fieldset aria-label={translate('analysisOptions')} style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', border: 0, margin: '0 0 12px', padding: 0, minWidth: 0 }}>
                    {(['harassment', 'habitatModification'] as AnalysisOption[]).map(option => (
                      <label key={option} style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                        <input
                          type='radio'
                          name={`analysis-option-${props.id}`}
                          value={option}
                          checked={analysisOption === option}
                          onChange={() => { setAnalysisOption(option) }}
                        />
                        {translate(option)}
                      </label>
                    ))}
                  </fieldset>

                  <div style={{ marginBottom: 8, fontStyle: 'normal' }}>
                    {translate('suitableHabitatFor').replace('{species}', drawingHabitatSpecies ?? translate('selectSpecies'))}
                  </div>
                  {isLoadingSpecies
                    ? <div role='status'>{translate('loadingSpecies')}</div>
                    : breedingSpecies.length === 0
                      ? <div>{translate('noIntersectingSpecies')}</div>
                      : (
                        <div style={{ display: 'grid', gap: 6, marginBottom: 16, minWidth: 0 }}>
                          {breedingSpecies.map(species => {
                            const isSelected = drawingHabitatSpecies === species.name
                            return (
                              <button
                                key={species.name}
                                type='button'
                                aria-pressed={isSelected}
                                onClick={() => { setDrawingHabitatSpecies(species.name) }}
                                style={{
                                  width: '100%',
                                  padding: '2px 8px',
                                  boxSizing: 'border-box',
                                  borderRadius: 2,
                                  border: '1px solid rgb(201 188 172)',
                                  background: isSelected
                                    ? `rgba(${getSpeciesColor(species.symbol).r}, ${getSpeciesColor(species.symbol).g}, ${getSpeciesColor(species.symbol).b}, 0.15)`
                                    : 'rgba(126, 100, 73, 0.1)',
                                  color: 'var(--sys-color-surface-paper-text)',
                                  outline: 'none',
                                  cursor: 'pointer',
                                  textAlign: 'start',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  fontWeight: isSelected ? 500 : 400
                                }}
                                css={css`
                                  &:focus,
                                  &:focus-visible {
                                    outline: 2px solid ${getSpeciesColor(species.symbol).toCss()};
                                    outline-offset: 1px;
                                    box-shadow: none;
                                  }
                                `}
                              >
                                <svg
                                  aria-hidden='true'
                                  width='24'
                                  height='24'
                                  viewBox='0 0 24 24'
                                  style={{ flex: '0 0 auto' }}
                                  css={css`
                                    fill: none;
                                    stroke: ${getSpeciesColor(species.symbol).toCss()};
                                    stroke-width: 3px;
                                  `}
                                >
                                  <polygon
                                    points='3,2 21,8 21,22 3,22'
                                  />
                                </svg>
                                {species.name}
                              </button>
                            )
                          })}
                        </div>
                      )}
                </>
              )}

              {showDrawingToolbar && <div style={{ marginBottom: 0 }}>{translate('selectDrawMode')}</div>}
              {geometryEngine
                ? (
                  <div
                    className='analysis-draw-toolbar'
                    style={{ display: showDrawingToolbar ? undefined : 'none', marginBottom: 16 }}
                    css={css`
                      flex: 0 0 auto;
                      height: 36px;
                      overflow: visible;

                      > .jimu-draw-layouts-container.h-100 {
                        height: 36px !important;
                        min-height: 0;
                        overflow: visible;
                      }

                      .jimu-draw-layouts-container calcite-action[data-testid="additional-bts-expand-collapse"] {
                        display: none !important;
                      }

                      .toolbar-layout-container,
                      .jimu-draw-tool,
                      .jimu-draw-sketch-tools {
                        height: 36px;
                      }
                    `}
                  >
                    <JimuDraw
                      jimuMapView={jimuMapView}
                      operatorWidgetId={props.id}
                      drawingOptions={{
                        creationMode: JimuDrawCreationMode.Continuous,
                        visibleElements,
                        updateOnGraphicClick: true,
                        layerListMode: 'show',
                        tooltipOptions: { enabled: true }
                      }}
                      uiOptions={{ isAutoWidth: true, isAutoHeight: true }}
                      onJimuDrawCreated={handleDrawCreated}
                      onToolsActivated={handleToolsActivated}
                      onDrawingFinished={handleDrawingFinished}
                      onDrawingUpdated={handleDrawingUpdated}
                      onDrawingCleared={handleDrawingCleared}
                      disableSymbolSelector
                    />
                  </div>
                )
                : <div role='status'>{translate('loadingMeasurements')}</div>}

              {error && <div role='alert' style={{ marginTop: 4, color: 'var(--sys-color-error-main)' }}>{error}</div>}
              {footprint
                ? (
                  <div style={{ display: 'grid', gap: 8, marginTop: 8, minWidth: 0 }}>
                    {[footprint, ...habitatFeatures].map(feature => (
                      <div key={feature.id} style={{ border: '1px solid rgb(201 188 172)', borderRadius: 2, padding: '5px 10px', minWidth: 0, boxSizing: 'border-box' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {feature.type === 'footprint' && (
                              <span
                                aria-hidden='true'
                                style={{ width: 16, height: 12, background: 'rgba(0, 0, 0, 0.25)', border: '1px solid rgba(0, 0, 0, 0.8)', borderRadius: 4, display: 'inline-block' }}
                              />
                            )}
                            {feature.name}
                          </div>
                          {feature.type === 'habitat' && (
                            <button
                              type='button'
                              aria-label={`${translate('deleteHabitat')}: ${feature.name}`}
                              title={translate('deleteHabitat')}
                              onClick={() => { void deleteHabitatFeature(feature) }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 4,
                                border: 0,
                                borderRadius: 4,
                                background: 'transparent',
                                color: 'var(--sys-color-surface-paper-text)',
                                cursor: 'pointer'
                              }}
                            >
                              <svg aria-hidden='true' width='16' height='16' viewBox='0 0 16 16' fill='none'>
                                <path d='M2.5 4h11M6 4V2.5h4V4m2.5 0-.6 9H4.1l-.6-9m3 2.5v4m3-4v4' stroke='currentColor' strokeWidth='1' strokeLinecap='round' strokeLinejoin='round' />
                              </svg>
                            </button>
                          )}
                        </div>
                        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, margin: '8px 0 0', fontWeight: 400 }}>
                          <dt style={{ fontWeight: 400 }}>{translate('area')}</dt>
                          <dd style={{ margin: 0, fontWeight: 400 }}>{formatUSNumber(feature.area)} sq ft</dd>
                          <dt style={{ fontWeight: 400 }}>{translate('perimeter')}</dt>
                          <dd style={{ margin: 0, fontWeight: 400 }}>{formatUSNumber(feature.perimeter)} ft</dd>
                        </dl>
                      </div>
                    ))}
                  </div>
                )
                : <div style={{ textAlign: 'center' }}>{translate('noFeatures')}</div>}

              <div style={{ display: 'flex', gap: 8, marginTop: 16, marginBottom: 20, minWidth: 0, flexWrap: 'wrap' }}>
                <button
                  id='redraw-footprint-button'
                  type='button'
                  disabled={!footprint || habitatFeatures.length > 0}
                  onClick={async () => {
                    if (await clearDrawing()) {
                      resetAnalysis()
                    }
                  }}
                >
                  {translate('redrawFootprint')}
                </button>
                <button
                  id='calculate-results-button'
                  type='button'
                  disabled={!hasHabitatForEverySpecies || analysisOption !== 'harassment'}
                  onClick={calculateHarassmentResults}
                >
                  {translate('calculateResults')}
                </button>
              </div>
            </section>

            <section
              id={panelId('results')}
              role='tabpanel'
              aria-labelledby={tabId('results')}
              hidden={activeTab !== 'results'}
              style={{ padding: '12px 10px 0', overflow: 'auto', height: '100%', minHeight: 0, flex: 1, boxSizing: 'border-box' }}
            >
              {resultsCalculated && (
                harassmentResults.length
                  ? (
                    <div style={{ width: '100%', overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                          <tr>
                            {(['species', 'maxPairs', 'meanPairs', 'proportionImpacted'] as const).map(column => (
                              <th
                                key={column}
                                scope='col'
                                style={{ padding: '8px', borderBottom: '1px solid var(--sys-color-surface-paper-hint)' }}
                              >
                                {translate(column)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {harassmentResults.map(result => (
                            <tr key={result.id}>
                              <td style={{ padding: '8px', borderBottom: '1px solid var(--sys-color-surface-paper-hint)' }}>{result.species}</td>
                              <td style={{ padding: '8px', borderBottom: '1px solid var(--sys-color-surface-paper-hint)' }}>{result.maxPairs ?? ''}</td>
                              <td style={{ padding: '8px', borderBottom: '1px solid var(--sys-color-surface-paper-hint)' }}>{result.meanPairs ?? ''}</td>
                              <td style={{ padding: '8px', borderBottom: '1px solid var(--sys-color-surface-paper-hint)' }}>{result.proportionImpacted}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                  : <div>{translate('noHarassmentResults')}</div>
              )}
            </section>
          </div>
        )}
    </Paper>
  )
}

export default Widget
