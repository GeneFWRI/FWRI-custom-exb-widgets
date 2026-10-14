/** @jsx jsx */
import { React, jsx, type AllWidgetProps, ReactResizeDetector, ExBAddedJSAPIProperties, SupportedJSAPILayerTypes, loadArcGISMapComponents } from 'jimu-core'
import { JimuMapViewComponent, type JimuMapView, type JimuLayerView } from 'jimu-arcgis'
import { WidgetPlaceholder, FillType, Paper } from 'jimu-ui'
import { ELegendMode, type IMConfig, type Style } from '../config'
import { getStyle } from './lib/style'
import defaultMessages from './translations/default'
import legendIcon from '../../icon.svg'
import { versionManager } from '../version-manager'
import * as reactiveUtils from 'esri/core/reactiveUtils'

export enum LoadStatus {
  Pending = 'Pending',
  Fulfilled = 'Fulfilled',
  Rejected = 'Rejected'
}

export interface WidgetProps extends AllWidgetProps<IMConfig> {
}

export interface WidgetState {
  loadStatus: LoadStatus
  activeJmv: JimuMapView
}

type ArcgisLegendElement = HTMLArcgisLegendElement & {
  view: __esri.MapView | __esri.SceneView
  activeLayerInfos?: __esri.Collection<__esri.ActiveLayerInfo>
  basemapLegendVisible: boolean
  hideLayersNotInCurrentView: boolean
  ignoreLayerVisibility: boolean
  respectLayerDefinitionExpression: boolean
  legendStyle: 'card' | 'classic'
  cardStyleLayout: 'auto' | 'side-by-side' | 'stack' | undefined
  destroy: () => Promise<void>
}

const CARD_ROOT_FILL_STYLE_ID = 'exb-legend-card-fill-style'
const CARD_VIEW_FILL_STYLE_ID = 'exb-legend-card-view-fill-style'

const CARD_ROOT_FILL_CSS = `
  .root {
    min-height: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  arcgis-legend-card-view {
    min-height: 0;
    flex: 1 1 auto;
    height: 100%;
  }
`

const CARD_VIEW_FILL_CSS = `
  :host {
    min-height: 0;
    height: 100%;
  }

  calcite-carousel {
    min-height: 0;
    height: 100%;
  }

  calcite-carousel-item {
    min-height: 0;
    height: 100%;
  }
`

export default class Widget extends React.PureComponent<WidgetProps, WidgetState> {
  private legend: ArcgisLegendElement
  private currentWidth: number
  private loadMapComponentsPromise: Promise<void>
  private customizeActiveLayerInfosHandle: { remove: () => void }
  private legendReadyHandler: () => void
  legendWrapperRef = React.createRef<HTMLDivElement>()
  legendContainerRef = React.createRef<HTMLDivElement>()

  static versionManager = versionManager

  constructor (props) {
    super(props)
    this.state = {
      loadStatus: LoadStatus.Pending,
      activeJmv: null
    }
  }

  componentDidUpdate (prevProps: Readonly<WidgetProps>, prevState: Readonly<WidgetState>, snapshot?: any): void {
    if (this.state.activeJmv && (prevState.activeJmv?.id !== this.state.activeJmv?.id || prevProps.config !== this.props.config)) {
      const activeJmvId = this.state.activeJmv.id
      const customizeLayerOptionsChanged = prevProps.config?.customizeLayerOptions?.[activeJmvId] !== this.props.config?.customizeLayerOptions?.[activeJmvId]
      const activeJmvChanged = prevState.activeJmv?.id !== this.state.activeJmv?.id
      this.createLegend(this.state.activeJmv.view, activeJmvChanged || customizeLayerOptionsChanged, this.state.activeJmv).catch(() => {
        this.setState({
          loadStatus: LoadStatus.Rejected
        })
      })
    }
  }

  componentWillUnmount (): void {
    this.destroyLegend()
  }

  destroyLegend = () => {
    this.customizeActiveLayerInfosHandle?.remove?.()
    this.customizeActiveLayerInfosHandle = null
    if (this.legend && this.legendReadyHandler) {
      this.legend.removeEventListener('arcgisReady', this.legendReadyHandler as EventListener)
    }
    this.legendReadyHandler = null
    if (this.legend) {
      const legend = this.legend
      this.legend = null
      legend.remove?.()
      legend.destroy?.()
    }
  }

  ensureMapComponentsLoaded = async (): Promise<void> => {
    if (!this.loadMapComponentsPromise) {
      this.loadMapComponentsPromise = loadArcGISMapComponents()
    }
    try {
      await this.loadMapComponentsPromise
    } catch (error) {
      this.loadMapComponentsPromise = null
      throw error
    }
  }

  cacheLegendWrapperSize = () => {
    const wrapper = this.legendWrapperRef.current
    if (!wrapper) {
      return
    }
    if (wrapper.clientWidth > 0) {
      this.currentWidth = wrapper.clientWidth
    }
  }

  syncLegendSize = () => {
    if (!this.legend) {
      return
    }
    const style = (this.legend as unknown as HTMLElement).style
    if (!style) {
      return
    }

    style.width = '100%'
    style.display = 'block'
    style.height = '100%'
  }

  ensureCardViewFullHeight = () => {
    if (!this.legend || !this.props.config.cardStyle) {
      return
    }

    const legendElement = this.legend as unknown as HTMLElement
    const legendShadowRoot = legendElement.shadowRoot
    if (!legendShadowRoot) {
      return
    }

    if (!legendShadowRoot.getElementById(CARD_ROOT_FILL_STYLE_ID)) {
      const style = document.createElement('style')
      style.id = CARD_ROOT_FILL_STYLE_ID
      style.textContent = CARD_ROOT_FILL_CSS
      legendShadowRoot.appendChild(style)
    }

    const cardView = legendShadowRoot.querySelector<HTMLElement>('arcgis-legend-card-view')
    const cardShadowRoot = cardView?.shadowRoot
    if (!cardShadowRoot) {
      return
    }

    if (!cardShadowRoot.getElementById(CARD_VIEW_FILL_STYLE_ID)) {
      const style = document.createElement('style')
      style.id = CARD_VIEW_FILL_STYLE_ID
      style.textContent = CARD_VIEW_FILL_CSS
      cardShadowRoot.appendChild(style)
    }
  }

  bindLegendReadyEvent = (jimuMapView: JimuMapView = this.state.activeJmv) => {
    if (!this.legend) {
      return
    }
    if (this.legendReadyHandler) {
      this.legend.removeEventListener('arcgisReady', this.legendReadyHandler as EventListener)
    }
    this.legendReadyHandler = () => {
      this.syncLegendSize()
      this.ensureCardViewFullHeight()
      this.customizeLegends(jimuMapView)
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          if (!this.legend) return
          this.syncLegendSize()
          this.ensureCardViewFullHeight()
        })
      }
    }
    this.legend.addEventListener('arcgisReady', this.legendReadyHandler as EventListener)
  }

  createLegend = async (view: __esri.MapView | __esri.SceneView, forceRecreate = false, jimuMapView: JimuMapView = this.state.activeJmv) => {
    await this.ensureMapComponentsLoaded()
    await view.when()

    const container = this.legendContainerRef.current
    if (!container) {
      return
    }

    const viewChanged = this.legend && this.legend.view !== view
    if (!this.legend || this.legend.parentNode !== container || viewChanged || forceRecreate) {
      this.destroyLegend()
      this.legend = document.createElement('arcgis-legend') as ArcgisLegendElement
      container.replaceChildren(this.legend)
    }

    this.cacheLegendWrapperSize()
    this.syncLegendSize()
    this.bindLegendReadyEvent(jimuMapView)

    this.configLegend()
    if (this.legend.view !== view) {
      this.legend.view = view
    }
    this.customizeLegends(jimuMapView)
    this.ensureCardViewFullHeight()
  }

  filterActiveLayerInfos = (jimuMapView: JimuMapView = this.state.activeJmv) => {
    const activeLayerInfos = this.legend?.activeLayerInfos
    if (!this.legend || !jimuMapView || !activeLayerInfos) {
      return
    }
    const customizeOptions = this.props.config.customizeLayerOptions?.[jimuMapView?.id]
    if (!customizeOptions?.isEnabled) {
      return
    }

    const showRuntimeAddedLayer = customizeOptions.showRuntimeAddedLayers
    const showSet = new Set(customizeOptions.showJimuLayerViewIds || [])
    for (const item of [...activeLayerInfos]) {
      const layer = item.layer
      const isRuntimeAdded = layer[ExBAddedJSAPIProperties.EXB_LAYER_FROM_RUNTIME]
      if (isRuntimeAdded) {
        !showRuntimeAddedLayer && activeLayerInfos.remove(item)
      } else {
        const jlvId = jimuMapView.getJimuLayerViewIdByAPILayer(layer)
        const childInfos = this.getAllChildActiveInfos(item)
        if (!showSet.has(jlvId)) {
          activeLayerInfos.remove(item)
        }
        for (const childInfo of childInfos) {
          const childJlvId = jimuMapView.getJimuLayerViewIdByAPILayer(childInfo.layer)
          if (!showSet.has(childJlvId)) {
            childInfo.parent?.children?.remove(childInfo)
          }
        }
      }
    }
  }

  customizeLegends = (jimuMapView: JimuMapView = this.state.activeJmv) => {
    this.customizeActiveLayerInfosHandle?.remove?.()
    this.customizeActiveLayerInfosHandle = null
    if (!jimuMapView || !this.props.config.customizeLayerOptions?.[jimuMapView?.id]?.isEnabled || !this.legend) {
      return
    }

    const legend = this.legend
    this.customizeActiveLayerInfosHandle = reactiveUtils.on(() => legend.activeLayerInfos, 'change', () => {
      if (legend === this.legend) {
        this.filterActiveLayerInfos(jimuMapView)
      }
    })
    this.filterActiveLayerInfos(jimuMapView)
  }

  getAllChildActiveInfos = (activeInfo: __esri.ActiveLayerInfo, result: __esri.ActiveLayerInfo[] = []) => {
    if (activeInfo.children) {
      for (const childInfo of activeInfo.children) {
        result.push(childInfo)
        this.getAllChildActiveInfos(childInfo, result)
      }
    }
    return result
  }

  isRuntimeLayer = (layer: __esri.Layer | __esri.Sublayer): boolean => {
    const isRuntimeAdded = this.props.config.customizeLayerOptions?.[this.state.activeJmv?.id]?.showRuntimeAddedLayers && layer[ExBAddedJSAPIProperties.EXB_LAYER_FROM_RUNTIME]
    return isRuntimeAdded
  }

  isSpecialLayer = (layer: __esri.Layer | __esri.Sublayer): boolean => {
    let parentLayer = layer.parent
    const layerTypes: string[] = [
      'esri.layers.WMTSLayer',
    ]

    while (parentLayer) {
      if (layerTypes.includes(parentLayer.declaredClass)) {
        return true
      }
      parentLayer = (parentLayer as any).parent
    }

    return false
  }

  isParentVisible (layer: __esri.Layer | __esri.Sublayer, showSet: Set<string>) {
    const allParentLayers = getParents(layer)
    // No parent
    if (allParentLayers.length === 0) {
      return true
    }
    for (const parentLayer of allParentLayers) {
      const parentJlvId = this.state.activeJmv.getJimuLayerViewIdByAPILayer(parentLayer)
      if (!showSet.has(parentJlvId)) {
        return false
      }
    }
    return true

    function getParents (layer: __esri.Layer | __esri.Sublayer) {
      const ret = []
      let currLayer: any = layer
      // Skip ground
      while (currLayer.parent && currLayer.parent.parent) {
        ret.push(currLayer.parent)
        currLayer = currLayer.parent
      }
      return ret
    }
  }

  handleLayerWithSublayer (jimuLayerView: JimuLayerView, showSet: Set<string>, sublayersMap: Map<__esri.Layer, string[]>) {
    const supportedTypes: string[] = [SupportedJSAPILayerTypes.MapImageLayer, SupportedJSAPILayerTypes.SubtypeGroupLayer, SupportedJSAPILayerTypes.WMSLayer]
    const parentJlv = jimuLayerView.getParentJimuLayerView()
    if (!supportedTypes.includes(parentJlv.type)) {
      return
    }
    // Only construct layerInfo when all the parents are selected
    if (!this.isParentVisible(jimuLayerView.layer, showSet)) {
      return
    }

    const sublayerId = jimuLayerView.type === SupportedJSAPILayerTypes.SubtypeSublayer ? (jimuLayerView.layer as __esri.SubtypeSublayer).subtypeCode : jimuLayerView.layer.id

    if (sublayersMap.has(parentJlv.layer)) {
      sublayersMap.get(parentJlv.layer).push(sublayerId)
    } else {
      sublayersMap.set(parentJlv.layer, [sublayerId])
    }
  }

  configLegend = () => {
    if (this.legend) {
      const basemapLegendVisible = this.props.config.showBaseMap
      this.legend.basemapLegendVisible = basemapLegendVisible
      this.legend.respectLayerDefinitionExpression = !!this.props.config.respectLayerDefinitionExp
      this.applyLegendStyle(this.calculateStyle())
      const legendMode = this.props.config.legendMode

      this.legend.ignoreLayerVisibility = legendMode === ELegendMode.ShowAll
      this.legend.hideLayersNotInCurrentView = legendMode === ELegendMode.ShowWithinExtent
      this.ensureCardViewFullHeight()
    }
  }

  applyLegendStyle = (style: 'classic' | { type: 'card', layout: 'side-by-side' | 'stack' }) => {
    if (!this.legend) {
      return
    }
    if (style === 'classic') {
      this.legend.legendStyle = 'classic'
      this.legend.cardStyleLayout = undefined
    } else {
      this.legend.legendStyle = style.type
      this.legend.cardStyleLayout = style.layout
    }
  }

  calculateStyle = (): 'classic' | { type: 'card', layout: 'side-by-side' | 'stack' } => {
    const currentWidth = this.currentWidth || 100000// window.innerWidth;
    if (this.props.config.cardStyle) {
      let layout
      if (!this.props.config.cardLayout || this.props.config.cardLayout === 'auto') {
        if (currentWidth <= 600) {
          layout = 'stack'
        } else {
          layout = 'side-by-side'
        }
      } else {
        layout = this.props.config.cardLayout
      }
      return {
        type: 'card' as const,
        layout: layout
      }
    }
    return 'classic'
  }

  getDefaultStyleConfig (): Style {
    return {
      useCustom: false,
      background: {
        color: '',
        fillType: FillType.FILL
      },
      fontColor: ''
    }
  }

  getStyleConfig () {
    if (this.props.config.style && this.props.config.style.useCustom) {
      return this.props.config.style
    } else {
      return this.getDefaultStyleConfig()
    }
  }

  onActiveViewChange = async (jimuMapView: JimuMapView) => {
    if (jimuMapView && jimuMapView.view) {
      try {
        await this.createLegend(jimuMapView.view, true, jimuMapView)
        this.setState({
          loadStatus: LoadStatus.Fulfilled,
          activeJmv: jimuMapView
        })
      } catch (error) {
        this.destroyLegend()
        this.setState({
          loadStatus: LoadStatus.Rejected
        })
      }
    } else {
      this.destroyLegend()
    }
  }

  onResize = ({ width }) => {
    this.currentWidth = width
    if (this.legend && this.props.config.cardStyle && this.props.config.cardLayout === 'auto') {
      const style = this.calculateStyle()
      this.applyLegendStyle(style)
      this.ensureCardViewFullHeight()
    }
  }

  render () {
    const useMapWidget = this.props.useMapWidgetIds && this.props.useMapWidgetIds[0]

    let content

    if (!useMapWidget) {
      this.destroyLegend()
      content = (
        <div className='widget-legend'>
          <WidgetPlaceholder icon={legendIcon} autoFlip name={this.props.intl.formatMessage({ id: '_widgetLabel', defaultMessage: defaultMessages._widgetLabel })} widgetId={this.props.id} />
        </div>
      )
    } else {
      let loadingContent = null
      const dataSourceContent = <JimuMapViewComponent useMapWidgetId={this.props.useMapWidgetIds?.[0]} onActiveViewChange={this.onActiveViewChange} />
      if (this.state.loadStatus === LoadStatus.Pending) {
        loadingContent = (
          <div className='jimu-secondary-loading' />
        )
      }

      if (window.jimuConfig.isInBuilder) {
        this.configLegend()
      }
      content = (
        <div className='widget-legend' ref={this.legendWrapperRef}>
          {loadingContent}
          <div className='legend-container' ref={this.legendContainerRef} />
          <div style={{ position: 'absolute', display: 'none' }}>
            {dataSourceContent}
          </div>
          <ReactResizeDetector targetRef={this.legendWrapperRef} handleHeight handleWidth onResize={this.onResize} />
        </div>
      )
    }
    return (
      <Paper variant='flat' css={getStyle(this.props.theme, this.getStyleConfig())} className='jimu-widget' shape='none'>
        {content}
      </Paper>
    )
  }
}
