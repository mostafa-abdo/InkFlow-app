import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * Runtime-aware fullscreen toggle.
 * Inside Tauri the window is controlled through the native plugin;
 * elsewhere (browser preview/tests) we fall back to the Fullscreen API.
 */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

export const isFullscreenNow = async (): Promise<boolean> => {
  if (isTauri()) {
    return getCurrentWindow().isFullscreen()
  }
  return typeof document !== 'undefined' && Boolean(document.fullscreenElement)
}

export const setFullscreen = async (target: boolean): Promise<void> => {
  if (isTauri()) {
    await getCurrentWindow().setFullscreen(target)
    return
  }
  if (typeof document === 'undefined') return
  if (target && !document.fullscreenElement) {
    await document.documentElement.requestFullscreen()
  } else if (!target && document.fullscreenElement) {
    await document.exitFullscreen()
  }
}
