# DeskMirror for browsers · Changes

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
