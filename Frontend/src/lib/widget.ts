import { Capacitor, registerPlugin } from '@capacitor/core'
import type { MyShiftsResponse } from '../types'
import { widgetPayload } from './widgetPayload'

// Feeds the iOS home-screen widget (ios/App/FruitCrewWidget): the signed-in
// person's upcoming shifts, written to the shared App Group by the native
// WidgetBridgePlugin. The JSON itself is built in widgetPayload.ts.

const WidgetBridge = registerPlugin<{ setShifts(o: { json: string }): Promise<void> }>('WidgetBridge')

export const widgetAvailable = () => Capacitor.getPlatform() === 'ios'

/** null = signed out. Never throws — a widget that's a bit stale isn't worth an error. */
export async function syncWidget(data: MyShiftsResponse | null, signedIn: boolean): Promise<void> {
  if (!widgetAvailable()) return
  await WidgetBridge.setShifts({ json: widgetPayload(data, signedIn) }).catch(() => {})
}
