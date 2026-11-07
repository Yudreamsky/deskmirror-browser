# DeskMirror for browsers · Changes

## 0.9.1 (2026-11-07)
- Selecting text inside the mirror now selects the translation you see: wherever you drag, that part of the translation is highlighted, and Ctrl+C copies the translation. Double-click for a word, triple-click for a paragraph, Shift+click to extend, and dragging selected text away all work on the translation too. Before, the highlight was hidden under the translation and copying gave the original underneath. This matters most in whole-page mode, where you are really working with the translated page.
- While you hold Ctrl+Alt+O to see the original, you select and copy the original; let go and the highlight on the translation is still there. If part of the selection is outside the mirror (where you see the original), copying still gives the original; in whole-page mode it is always the translation.
- When the text next to a button changes (for example, a counter after you click Save), the button's label no longer switches back to the original.

## 0.9.0 (2026-11-07)
- Whole-page translation: drag the bubble to the very top of the page and the mirror's frame opens out to cover the whole page, so the entire page is translated. The bubble becomes a half-ball docked at the top that follows the pointer sideways; let go and it tucks in a little, and it slides out when you hover over it.
- Back from the whole page: drag the half-ball at the top down and it shrinks into a dashed frame the size the mirror had, following the pointer; let go and it is the mirror again (or drag it to the left or right edge to dock it as a bubble). Clicking the half-ball shrinks it back to the mirror where it was.
- Moving the mirror by the grip on its tab never turns it into the whole page, even at the top; only dragging the bubble does. In whole-page mode the frame follows window resizes, and closing from the toolbar shrinks it into the bubble, which then opens back to the mirror you had.

## 0.8.0 (2026-10-15)
- Video subtitles: when the mirror covers a video with captions turned on, the whole subtitle track is read and translated ahead of playback (the next five minutes, topped up as it plays; after a seek, that part first), and each line replaces the original caption inside the mirror. Outside the mirror the original captions stay. Only captions that are turned on are translated; hold Ctrl+Alt+O to see the originals.
- Where the subtitles come from: subtitle tracks on the page (`<track>`, and players that use them, such as video.js and Plyr) are read directly. YouTube's caption requests need a token the player computes on the spot, so fetching them ourselves only returns empty files; a small script on the page copies the captions when the player loads them, and asks the player to load them again if it already had.
- YouTube's auto-generated captions arrive word by word, so they are joined into sentences at pauses and line ends before translation; when the text on screen doesn't match the track at that moment (during an ad, for example), the original is left alone.
- Fullscreen: when the player goes fullscreen, the translations follow; when the video element itself goes fullscreen, the subtitle track temporarily holds the translations and gets its own text back afterwards.
- Captions that players draw over the video are no longer translated as ordinary page text: the video is a hole in the mirror, so those translations never showed and only used tokens.

## 0.7.1 (2026-10-10)
- After a text box is translated, press Space three times again to switch back to the original, and again for the translation. Both stay in the page's memory, so switching sends no request and uses no tokens; if you edit the original or change the "Translate input boxes into" language, it translates again.
- In web editors that keep their own copy of the text (Slate and CKEditor 5, for example), the translation used to only look replaced: the editor still held the original, so the next key brought it back and the original was what got sent. The translation now goes in through the editor itself. Tried on the demo editors of Slate, Lexical, ProseMirror, Quill, Draft.js, CKEditor 5 and Trix.
- In editors that make each line a paragraph, translated text keeps its paragraphs instead of gaining a blank line between them.

## 0.7.0 (2026-10-10)
- A grip at the left end of the tab: drag the mirror by it to the left or right edge of the page and it shrinks into a ball docked there, half tucked in, and translation pauses. Drag the ball out and it smoothly turns into a dashed frame that follows the pointer while translation starts; let go and it lands as the mirror. You can go back and forth in one drag.
- New option "Show the mirror bubble on every page" (Settings, Appearance): every page you open gets a mirror bubble half tucked into the edge; click it to open the mirror, and closing the mirror shrinks it back into the bubble. Pressing Space three times in text boxes then works on every page too. The bubble copies and translates nothing until you open it, adding about 10 ms per page. Chrome asks for access to all websites when you turn it on.
- When a page shows only the bubble, the toolbar icon or Alt+Shift+M opens it into the mirror.
- Cards that move by themselves (carousels and marquees, such as the horizontal cards on labs.google/playground) now stay aligned inside the mirror: the copy follows the page's own animations and transitions. Changes inside shadow DOM right after the mirror opens are no longer missed.
- Closing the mirror stops unfinished translation requests at once, so they no longer use tokens.
- Printing a page no longer prints the frame or the bubble.

## 0.6.0 (2026-10-08)
- Input box translation: press Space three times in a text box on a page (at most half a second between presses) to translate what you typed, in your own language, into the "Translate input boxes into" language and replace it; Ctrl+Z undoes it. Works in single-line, multi-line and rich-text boxes; spaces for indentation or while choosing IME characters do not trigger it, and nothing is replaced if you keep typing meanwhile. Works on pages where you have opened the mirror, even after closing it.

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
