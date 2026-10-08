# 桌面魔镜 · 网页原位翻译（浏览器扩展）隐私政策

生效日期：2026 年 10 月 8 日

**一句话：扩展没有开发者自己的服务器，不收集、不出售任何数据。网页文字只发给你自己在设置里选的翻译服务。**

1. **不收集数据。** 不需要注册账号，不统计使用情况，不追踪浏览记录，开发者收不到你的任何数据。
2. **网页文字。** 你打开魔镜后，扩展读取当前网页上镜框附近的文字，发给你在设置里选的翻译服务（例如这台电脑上的 Ollama，或 DeepSeek、OpenAI、Google Gemini 等），再把译文显示在镜框里。用本机模型时，文字不离开你的电脑。翻译服务如何处理这些文字，以该服务自己的隐私政策为准。
3. **输入框里的文字。** 只有在你在某个输入框里连按三次空格时，扩展才把这个框里的文字发给你选的翻译服务，并把译文替换进框里。扩展不记录你的按键，也不保存框里的文字。
4. **设置和 API Key。** 语言、翻译服务列表和你填的 API Key 保存在这台电脑上 Chrome 的扩展存储里（chrome.storage.local），API Key 只发给它对应的翻译服务。卸载扩展时一起删除。
5. **出错记录。** 哪个翻译服务刚出过错、什么原因，只保存在浏览器的会话存储里（chrome.storage.session），关掉浏览器就清空，不会发到任何地方。
6. **权限。** activeTab 和 scripting：只在你点工具栏图标或按快捷键时，把魔镜放进当前网页；storage：保存上面说的设置；访问 127.0.0.1、localhost 和 api.deepseek.com：请求本机模型和 DeepSeek；访问其他网址的权限只在你添加该网址的翻译服务时才请求，而且只用于这个网址。
7. **不出售、不转让。** 不出售用户数据，不用于与翻译无关的目的，不用于判断信用或发放贷款。
8. **联系。** 有问题请写信：a885187@gmail.com

---

# DeskMirror – translate web pages in place (browser extension) Privacy Policy

Effective date: October 8, 2026

**In short: the extension has no developer server and collects or sells no data. Page text is sent only to the translation service you choose in Settings.**

1. **No data collection.** No account, no analytics, no tracking of your browsing. The developer receives none of your data.
2. **Page text.** When you open the mirror, the extension reads the text near the frame on the current page, sends it to the translation service you chose in Settings (for example Ollama on your own computer, or DeepSeek, OpenAI, Google Gemini and others), and shows the translation inside the frame. With a local model the text never leaves your computer. How a translation service handles the text is governed by that service's own privacy policy.
3. **Text in input boxes.** Only when you press Space three times in a text box does the extension send that box's text to the translation service you chose and put the translation back into the box. The extension does not record your keystrokes or keep the text.
4. **Settings and API keys.** Your languages, list of translation services and the API keys you enter are stored in Chrome's extension storage on this computer (chrome.storage.local). Each API key is sent only to its own translation service. Everything is removed when you uninstall the extension.
5. **Error records.** Which translation service failed recently, and why, is kept only in the browser's session storage (chrome.storage.session); it is cleared when the browser closes and is never sent anywhere.
6. **Permissions.** activeTab and scripting: put the mirror into the current page only when you click the toolbar icon or press the shortcut. storage: save the settings above. Access to 127.0.0.1, localhost and api.deepseek.com: reach local models and DeepSeek. Access to any other address is requested only when you add a translation service at that address, and is used only for it.
7. **No selling or transfer.** User data is not sold, not used for purposes unrelated to translation, and not used to determine creditworthiness or for lending.
8. **Contact.** Questions: a885187@gmail.com
