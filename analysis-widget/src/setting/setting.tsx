import { React, jsx, hooks, type ImmutableObject } from 'jimu-core'
import { SettingRow, SettingSection, MapWidgetSelector } from 'jimu-ui/advanced/setting-components'
import type { AllWidgetSettingProps } from 'jimu-for-builder'
import type { Config } from '../config'
import defaultMessages from './translations/default'

export default function Setting (props: AllWidgetSettingProps<ImmutableObject<Config>>): React.ReactElement {
  const translate = hooks.useTranslation(defaultMessages)

  const onMapChange = (useMapWidgetIds: string[]) => {
    props.onSettingChange({
      id: props.id,
      useMapWidgetIds
    })
  }

  return (
    <SettingSection title={translate('settings')}>
      <SettingRow flow='wrap' label={translate('mapWidget')}>
        <div style={{ width: '100%', minWidth: 0 }}>
          <MapWidgetSelector
            autoSelect={false}
            aria-label={translate('mapWidget')}
            useMapWidgetIds={props.useMapWidgetIds}
            onSelect={onMapChange}
          />
        </div>
      </SettingRow>
    </SettingSection>
  )
}
