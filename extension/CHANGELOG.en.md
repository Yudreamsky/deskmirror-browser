# DeskMirror for browsers · Changes

## 0.2.1 (2026-10-07)
- Fixed: on pages whose whole layout scrolls inside a container that also holds a fixed sidebar (such as the Tavily dashboard), the sidebar inside the mirror moved with the content after scrolling.

## 0.2.0 (2026-10-07)
- "Get models" in Settings: after you enter the API key, the models the service offers are listed; click one to use it. The DeepSeek default is now deepseek-flash.
- Pick "Your language" first: on first use it is guessed from the browser language; translations go into it by default and the interface follows it (Chinese for Chinese speakers, English for everyone else).
- Translation direction: choose the original and target languages in Settings, or any time with the language button on the mirror's tab; the page is re-translated right away. With a specific original language, only text in that language is translated.
- "Version and updates" in Settings: when the extension folder holds a newer version, update with one click; after an update, Settings opens and lists what changed.
- Clearer messages when the translation service can't be reached.

## 0.1.0 (2026-10-07)
- First prototype: a live copy of the page under the mirror, with the translation set into it and every block locked to the original's size; inside and outside the frame stay aligned frame by frame while scrolling.
