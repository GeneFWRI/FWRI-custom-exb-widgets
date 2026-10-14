import { React, type AllWidgetProps } from 'jimu-core'
import type { IMConfig } from '../config'
import WidgetDraw from './draw'

const Widget = (props: AllWidgetProps<IMConfig>) => {
  return (
    <div className="widget-habitat-analysis jimu-widget m-2">
      <p>ShoreMapper Analysis</p>
      <WidgetDraw {...props} />
    </div>
  )
}

export default Widget
