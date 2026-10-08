# DeskMirror for browsers · Changes

## 0.5.3 (2026-10-08)
- The Liquid Glass language menu is much less transparent (light and dark), so what is behind it no longer gets in the way of reading.

## 0.5.2 (2026-10-08)
- While collapsed, hovering over the bubble also shows the tokens sent and received since the mirror opened.

## 0.5.1 (2026-10-08)
- Liquid Glass now refracts at the edges: the rims of the tab, language menu and bubble stretch and bend what is behind them (like thick curved glass), with a hint of color dispersion. The glass is clearer, and text has a soft halo so it stays readable on busy backgrounds. Scrolling stays as smooth as before.

## 0.5.0 (2026-10-08)
- Collapse into a bubble: click "–" on the tab and the frame smoothly shrinks into a round bubble at the edge of the page. Drag it to the left or right and it snaps to that edge; after a moment it tucks halfway in and slides out when you point at it. Click the bubble and the mirror smoothly returns to where it was. Translation pauses while collapsed.
- Skins: Classic (like the desktop app) or Liquid Glass (frosted, rounded, with highlights; follows the system light or dark mode). Pick one under Appearance in Settings; open mirrors switch right away.

## 0.4.2 (2026-10-08)
- The mirror's top bar shows the tokens sent (↑) and received (↓) since the mirror opened, like a network monitor; hover for exact numbers. When a service does not report usage, it is estimated from the text length and marked with "≈".

## 0.4.1 (2026-10-08)
- Fixed: on pages where text sits on top of a canvas (such as the nodes and Markdown notes in Comfy Cloud, or chart legends), the mirror showed no translation. That text is now translated; the canvas itself and input boxes still show the real page.

## 0.4.0 (2026-10-07)
- Backup services: line up several translation services (for example Ollama Cloud → Ollama on this PC → DeepSeek). When one fails (out of credit, wrong key, model retired, unreachable, too slow), the next takes over without redoing finished text; a failed service is skipped for a while and retried later, and Save starts again from the main one.
- While a backup is in use, the mirror's tab shows "backup ② model" and its tooltip says why the main service failed; Settings lists which services are skipped and why, and "Test all" checks every one.
- An About section at the bottom of Settings with a feedback email; "Support the author" is folded inside it (entirely optional, unlocks nothing).
- The extension is now called "DeskMirror – translate web pages in place"; the buttons on the mirror's tab no longer get squeezed, and only the status text is shortened when space runs out.

## 0.3.1 (2026-10-07)
- Choosing "Ollama Cloud models" now finds the models your account can use right now (after a subscription expires most need paid usage, and some are retired); errors say whether a model needs paid usage or was retired.

## 0.3.0 (2026-10-07)
- Many more translation services: on this PC (Ollama, LM Studio), subscriptions (Ollama Cloud and the coding plans of Zhipu GLM, Kimi Code, Alibaba Model Studio, Volcano Ark and MiniMax), pay-as-you-go in China (DeepSeek, Qwen, Zhipu, Kimi, MiniMax, Doubao, SiliconFlow, Hunyuan, Qianfan, StepFun, ModelScope) and international (OpenAI, Gemini, Claude, OpenRouter, Groq, Mistral, Grok). Choosing one fills in the address; after getting the model list a light model is picked; keys are remembered per service.
- Each service's switch for turning off "thinking" is sent automatically; services that reject extra parameters get a plain request instead.
- Fixed: some sites insert styles by script, and part of them (padding and similar) was lost when copied (a browser limitation when reading such rules), so the mirror's content was shifted by tens of pixels (Vimeo and others). The page's computed values are now restored.

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
