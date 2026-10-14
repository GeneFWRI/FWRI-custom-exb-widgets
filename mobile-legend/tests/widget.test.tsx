import { React, ExBAddedJSAPIProperties, loadArcGISMapComponents } from 'jimu-core'
import Widget, { LoadStatus } from '../src/runtime/widget'
import { ELegendMode } from '../src/config'
import { WidgetPlaceholder } from 'jimu-ui'
import { mockTheme } from 'jimu-for-test'
import * as reactiveUtils from 'esri/core/reactiveUtils'
import { getStyle } from '../src/runtime/lib/style'

jest.mock('jimu-core', () => {
  const jimuCore = (jest as any).requireActual('jimu-core')
  jimuCore.loadArcGISMapComponents = jest.fn().mockResolvedValue(undefined)
  jimuCore.ReactResizeDetector = jest.fn(() => null)
  return jimuCore
})

jest.mock('jimu-arcgis', () => {
  const jimuArcgis = (jest as any).requireActual('jimu-arcgis')
  return {
    ...jimuArcgis,
    JimuMapViewComponent: jest.fn(() => null)
  }
})

jest.mock('esri/core/reactiveUtils', () => ({
  on: jest.fn()
}))

const defaultStyle = {
  useCustom: false,
  background: {
    color: '',
    fillType: 'FILL'
  },
  fontColor: ''
}

const createProps = (overrides = {}) => {
  return {
    id: 'legend_1',
    widgetId: 'legend_1',
    theme: mockTheme,
    config: {
      cardStyle: false,
      cardLayout: 'auto',
      legendMode: ELegendMode.ShowVisible,
      showBaseMap: false,
      style: defaultStyle,
      customizeLayerOptions: {}
    },
    intl: {
      formatMessage: jest.fn().mockImplementation(({ id, defaultMessage }) => defaultMessage || id)
    },
    useMapWidgetIds: ['map_1'],
    ...overrides
  } as any
}

const createCollection = (items = []) => {
  const collection = [...items] as any
  collection.remove = jest.fn((item) => {
    const index = collection.indexOf(item)
    if (index > -1) {
      collection.splice(index, 1)
    }
  })
  return collection
}

const findElementByType = (node: any, type: any): any => {
  if (!node) {
    return null
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    if (node.type === type) {
      return node
    }
    const children = React.Children.toArray(node.props.children)
    for (const child of children) {
      const target = findElementByType(child, type)
      if (target) {
        return target
      }
    }
  }
  return null
}

describe('Legend widget runtime', () => {
  const mockedLoadMapComponents = loadArcGISMapComponents as jest.MockedFunction<typeof loadArcGISMapComponents>
  const mockedReactiveOn = reactiveUtils.on as jest.Mock

  beforeEach(() => {
    mockedLoadMapComponents.mockClear()
    mockedReactiveOn.mockReset()
  })

  it('renders WidgetPlaceholder when no map widget is selected', () => {
    const widget = new Widget(createProps({ useMapWidgetIds: [] }))
    const tree = widget.render()

    expect(findElementByType(tree, WidgetPlaceholder)).toBeTruthy()
  })

  it('applies custom background color to card legend foreground', () => {
    const customBackground = '#123456'
    const styles = getStyle(mockTheme, {
      ...defaultStyle,
      useCustom: true,
      background: {
        color: customBackground,
        fillType: 'FILL'
      }
    } as any) as any

    expect(styles.styles).toContain(`background-color: ${customBackground};`)
    expect(styles.styles).toContain(`--calcite-color-foreground-1: ${customBackground};`)
  })

  it('keeps theme paper as card legend foreground without custom background color', () => {
    const styles = getStyle(mockTheme, defaultStyle as any) as any

    expect(styles.styles).toContain(`--calcite-color-foreground-1: ${mockTheme.sys.color.surface.paper};`)
  })

  it('maps config to legend component properties for ShowAll mode', () => {
    const widget = new Widget(createProps({
      config: {
        cardStyle: false,
        cardLayout: 'auto',
        legendMode: ELegendMode.ShowAll,
        showBaseMap: true,
        style: defaultStyle,
        customizeLayerOptions: {}
      }
    }))
    const legend = {
      basemapLegendVisible: false,
      ignoreLayerVisibility: false,
      hideLayersNotInCurrentView: false,
      respectLayerDefinitionExpression: false,
      legendStyle: 'classic',
      cardStyleLayout: undefined
    } as any

    ;(widget as any).legend = legend
    widget.configLegend()

    expect(legend.basemapLegendVisible).toBe(true)
    expect(legend.ignoreLayerVisibility).toBe(true)
    expect(legend.hideLayersNotInCurrentView).toBe(false)
    expect(legend.respectLayerDefinitionExpression).toBe(false)
    expect(legend.legendStyle).toBe('classic')
  })

  it('maps config to legend component properties for ShowWithinExtent mode', () => {
    const widget = new Widget(createProps({
      config: {
        cardStyle: false,
        cardLayout: 'auto',
        legendMode: ELegendMode.ShowWithinExtent,
        showBaseMap: false,
        respectLayerDefinitionExp: true,
        style: defaultStyle,
        customizeLayerOptions: {}
      }
    }))
    const legend = {
      basemapLegendVisible: true,
      ignoreLayerVisibility: true,
      hideLayersNotInCurrentView: false,
      respectLayerDefinitionExpression: false,
      legendStyle: 'classic',
      cardStyleLayout: undefined
    } as any

    ;(widget as any).legend = legend
    widget.configLegend()

    expect(legend.basemapLegendVisible).toBe(false)
    expect(legend.ignoreLayerVisibility).toBe(false)
    expect(legend.hideLayersNotInCurrentView).toBe(true)
    expect(legend.respectLayerDefinitionExpression).toBe(true)
  })

  it('updates card layout on resize when cardLayout is auto', () => {
    const widget = new Widget(createProps({
      config: {
        cardStyle: true,
        cardLayout: 'auto',
        legendMode: ELegendMode.ShowVisible,
        showBaseMap: false,
        style: defaultStyle,
        customizeLayerOptions: {}
      }
    }))
    const legend = {
      legendStyle: 'classic',
      cardStyleLayout: undefined
    } as any

    ;(widget as any).legend = legend
    widget.onResize({ width: 500 })
    expect(legend.legendStyle).toBe('card')
    expect(legend.cardStyleLayout).toBe('stack')

    widget.onResize({ width: 900 })
    expect(legend.legendStyle).toBe('card')
    expect(legend.cardStyleLayout).toBe('side-by-side')
  })

  it('filters customize layer infos with runtime and hidden layers', () => {
    const runtimeLayer = { [ExBAddedJSAPIProperties.EXB_LAYER_FROM_RUNTIME]: true }
    const visibleLayer = {}
    const hiddenLayer = {}
    const hiddenChildLayer = {}
    const parentChildren = { remove: jest.fn() }
    const hiddenChildInfo = { layer: hiddenChildLayer, parent: { children: parentChildren } }

    const runtimeInfo = { layer: runtimeLayer }
    const hiddenInfo = { layer: hiddenLayer, children: [hiddenChildInfo] }
    const visibleInfo = { layer: visibleLayer }
    const activeLayerInfos = createCollection([runtimeInfo, hiddenInfo, visibleInfo])
    const watcherRemove = jest.fn()

    mockedReactiveOn.mockImplementation((getter, eventName, callback) => {
      callback()
      return {
        remove: watcherRemove
      }
    })

    const props = createProps({
      config: {
        cardStyle: false,
        cardLayout: 'auto',
        legendMode: ELegendMode.ShowVisible,
        showBaseMap: false,
        style: defaultStyle,
        customizeLayerOptions: {
          map_1: {
            isEnabled: true,
            showRuntimeAddedLayers: false,
            showJimuLayerViewIds: ['visible-layer']
          }
        }
      }
    })

    const widget = new Widget(props)
    ;(widget as any).legend = {
      activeLayerInfos
    }
    widget.setState = jest.fn()
    ;(widget as any).state = {
      ...widget.state,
      activeJmv: {
        id: 'map_1',
        getJimuLayerViewIdByAPILayer: jest.fn((layer) => {
          if (layer === visibleLayer) {
            return 'visible-layer'
          }
          if (layer === hiddenLayer) {
            return 'hidden-layer'
          }
          if (layer === hiddenChildLayer) {
            return 'hidden-child-layer'
          }
          return null
        })
      }
    }

    widget.customizeLegends()

    expect(activeLayerInfos.remove).toHaveBeenCalledWith(runtimeInfo)
    expect(activeLayerInfos.remove).toHaveBeenCalledWith(hiddenInfo)
    expect(parentChildren.remove).toHaveBeenCalledWith(hiddenChildInfo)
    expect([...activeLayerInfos]).toEqual([visibleInfo])
  })

  it('filters again when active layer infos change', () => {
    const visibleLayer = { id: 'visible-layer' }
    const hiddenLayer = { id: 'hidden-layer' }
    const visibleInfo = { layer: visibleLayer }
    const hiddenInfo = { layer: hiddenLayer }
    const activeLayerInfos = createCollection([visibleInfo])
    let activeLayerInfosChangeCallback: () => void

    mockedReactiveOn.mockImplementation((getter, eventName, callback) => {
      activeLayerInfosChangeCallback = callback
      return {
        remove: jest.fn()
      }
    })

    const widget = new Widget(createProps({
      config: {
        cardStyle: false,
        cardLayout: 'auto',
        legendMode: ELegendMode.ShowVisible,
        showBaseMap: false,
        style: defaultStyle,
        customizeLayerOptions: {
          map_1: {
            isEnabled: true,
            showRuntimeAddedLayers: true,
            showJimuLayerViewIds: ['visible-layer']
          }
        }
      }
    }))
    ;(widget as any).legend = {}
    ;(widget as any).state = {
      ...widget.state,
      activeJmv: {
        id: 'map_1',
        getJimuLayerViewIdByAPILayer: jest.fn((layer) => layer === hiddenLayer ? 'hidden-layer' : 'visible-layer')
      }
    }

    widget.customizeLegends()
    expect(activeLayerInfosChangeCallback).toBeDefined()
    ;(widget as any).legend.activeLayerInfos = activeLayerInfos
    activeLayerInfos.push(hiddenInfo)
    activeLayerInfosChangeCallback()

    expect(mockedReactiveOn).toHaveBeenCalledWith(expect.any(Function), 'change', expect.any(Function))
    expect(activeLayerInfos.remove).toHaveBeenCalledWith(hiddenInfo)
    expect(activeLayerInfos.remove).not.toHaveBeenCalledWith(visibleInfo)
    expect([...activeLayerInfos]).toEqual([visibleInfo])
  })

  it('recreates arcgis-legend when view changes', async () => {
    const widget = new Widget(createProps())
    const container = document.createElement('div')
    const wrapper = document.createElement('div')
    Object.defineProperty(wrapper, 'clientHeight', { value: 420, configurable: true })
    widget.legendWrapperRef.current = wrapper
    widget.legendContainerRef.current = container

    const view1 = {
      when: jest.fn().mockResolvedValue(undefined)
    } as any
    const view2 = {
      when: jest.fn().mockResolvedValue(undefined)
    } as any

    await widget.createLegend(view1)
    const firstLegend = (widget as any).legend

    await widget.createLegend(view2)
    const secondLegend = (widget as any).legend

    expect(firstLegend).toBeTruthy()
    expect(secondLegend).not.toBe(firstLegend)
    expect(secondLegend.view).toBe(view2)
    expect(container.children).toHaveLength(1)
    expect(mockedLoadMapComponents).toHaveBeenCalledTimes(1)
  })

  it('sets legend element to fill container height during creation', async () => {
    const widget = new Widget(createProps())
    const container = document.createElement('div')
    const wrapper = document.createElement('div')

    Object.defineProperty(wrapper, 'clientHeight', { value: 360, configurable: true })
    widget.legendContainerRef.current = container
    widget.legendWrapperRef.current = wrapper

    const view = {
      when: jest.fn().mockResolvedValue(undefined)
    } as any

    await widget.createLegend(view)

    expect((widget as any).legend.style.height).toBe('100%')
  })

  it('recreates legend on active view change even when view instance is unchanged', async () => {
    const widget = new Widget(createProps())
    const container = document.createElement('div')
    const wrapper = document.createElement('div')
    Object.defineProperty(wrapper, 'clientHeight', { value: 300, configurable: true })
    widget.legendContainerRef.current = container
    widget.legendWrapperRef.current = wrapper
    widget.setState = jest.fn()

    const sharedView = {
      when: jest.fn().mockResolvedValue(undefined)
    } as any
    const jmv = {
      id: 'map_1',
      view: sharedView
    } as any

    await widget.onActiveViewChange(jmv)
    const firstLegend = (widget as any).legend

    await widget.onActiveViewChange(jmv)
    const secondLegend = (widget as any).legend

    expect(firstLegend).toBeTruthy()
    expect(secondLegend).toBeTruthy()
    expect(secondLegend).not.toBe(firstLegend)
    expect(container.children).toHaveLength(1)
    expect(mockedLoadMapComponents).toHaveBeenCalledTimes(1)
  })

  it('forces legend recreation when active customize layer options change', () => {
    const activeJmv = {
      id: 'map_1',
      view: {
        when: jest.fn().mockResolvedValue(undefined)
      }
    } as any
    const prevProps = createProps({
      config: {
        cardStyle: false,
        cardLayout: 'auto',
        legendMode: ELegendMode.ShowVisible,
        showBaseMap: false,
        style: defaultStyle,
        customizeLayerOptions: {
          map_1: {
            isEnabled: true,
            showRuntimeAddedLayers: true,
            showJimuLayerViewIds: ['visible-layer']
          }
        }
      }
    })
    const widget = new Widget(prevProps)
    const createLegend = jest.fn().mockResolvedValue(undefined)
    widget.createLegend = createLegend
    ;(widget as any).state = {
      ...widget.state,
      activeJmv
    }

    ;(widget as any).props = createProps({
      config: {
        cardStyle: false,
        cardLayout: 'auto',
        legendMode: ELegendMode.ShowVisible,
        showBaseMap: false,
        style: defaultStyle,
        customizeLayerOptions: {
          map_1: {
            isEnabled: true,
            showRuntimeAddedLayers: true,
            showJimuLayerViewIds: ['visible-layer', 'checked-layer']
          }
        }
      }
    })

    widget.componentDidUpdate(prevProps, {
      loadStatus: LoadStatus.Fulfilled,
      activeJmv
    } as any)

    expect(createLegend).toHaveBeenCalledWith(activeJmv.view, true, activeJmv)
  })

  it('destroys legend element and watcher handle', () => {
    const widget = new Widget(createProps())
    const removeHandle = jest.fn()
    const destroy = jest.fn().mockResolvedValue(undefined)
    const remove = jest.fn()

    ;(widget as any).customizeActiveLayerInfosHandle = { remove: removeHandle }
    ;(widget as any).legend = { destroy, remove }
    widget.destroyLegend()

    expect(removeHandle).toHaveBeenCalled()
    expect(remove).toHaveBeenCalled()
    expect(destroy).toHaveBeenCalled()
    expect((widget as any).legend).toBeNull()
  })
})
