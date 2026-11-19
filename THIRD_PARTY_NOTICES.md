# オープンソースライセンスと出典

PaperCue本体のライセンスは [MIT](LICENSE) です。同梱するソフトウェア、フォント、取得する論文の図には、それぞれの条件が適用されます。アプリ下部の「オープンソースライセンス」から通知文を開けます。配布アーカイブ内の `licenses/` にも本文を収録しています。

| 同梱物 | ライセンス・対応する上流ソース |
| --- | --- |
| Codex CLI / app-server 0.170.0 | Apache-2.0。[ソース](https://github.com/openai/codex/tree/rust-v0.170.0)。上流のLICENSEとNOTICEを同梱。ネイティブ実行環境の追加通知はCodexのvendorディレクトリ内 |
| Electron 45.3.4 | MIT。[ソース](https://github.com/electron/electron/tree/v45.3.4)。Chromium、Node.jsなどの通知はElectron同梱の `LICENSES.chromium.html` を参照 |
| MathJax 3.2.2 | Apache-2.0。[ソース](https://github.com/mathjax/MathJax-src/tree/3.2.2)。数式表示に使用 |
| Noto Sans、Noto Sans JP | SIL Open Font License 1.1。[提供元](https://github.com/fontsource/font-files)。同梱のOFL文書に著作権表示を収録 |
| sharp 0.35.5 | Apache-2.0。[ソース](https://github.com/lovell/sharp/tree/v0.35.5)。使用するnpmパッケージは `package-lock.json` を参照 |
| libvips 8.18.7と同梱ライブラリ | LGPLなど。[libvipsソース](https://github.com/libvips/libvips/tree/v8.18.7)・[ビルドスクリプトと依存ソースの取得手順](https://github.com/lovell/sharp-libvips/tree/v1.3.4)。OS別の上流パッケージに含まれるライセンス一覧を同梱 |
| resvg-js 2.6.2 | MPL-2.0。[対応するソースとビルド手順](https://github.com/yisibl/resvg-js/tree/v2.6.2)。ネイティブ側の依存バージョンは上流のCargo.lockを参照 |

## libvipsを使う部分

PaperCueは図の変換にsharpとlibvipsを使用します。libvipsの著作者はJohn Cupittほかで、各ファイルの著作権表示は[上流ソース](https://github.com/libvips/libvips/tree/v8.18.7)にあります。同梱のバイナリに適用されるライブラリごとの条件は `licenses/` 内のOS別READMEを参照してください。libvipsの上流ライセンス、GNU LGPL 3.0、GNU GPL 3.0の本文も同じ場所にあります。

Linux・macOS・Windowsでは、配布物の `resources/app.asar.unpacked` 以下にあるOS別のネイティブパッケージからライブラリを読み込みます。対応する上流ソースから改変版をビルドして、互換性のある共有ライブラリと差し替えることができます。PaperCueのソースからの再ビルド方法は [RELEASE.md](RELEASE.md) に記載しています。ソースの入手先に問題がある場合は [GitHub Issues](https://github.com/H1S4G10rc4/journal_recom/issues) にお知らせください。

## 論文と紹介文

配布物に論文本文や原図は含めていません。利用時に取得する図は、出典と確認できたライセンスを添えて表示します。arXivで閲覧できることと、図を別の資料に転載できることは別です。転載・改変・再配布の前に原文のライセンスと図個別のクレジットを確認してください。[arXivのライセンス案内](https://info.arxiv.org/help/license/index.html)

要約にはnihongoの考え方を取り入れたPaperCue用の推敲手順を同梱しています。端末に対応するnihongo 2.3.1資料がある場合は、その端末上の資料を読み込んで使います。読書の流れは[参考記事](https://note.com/john_doenote/n/nb514e544ce25)をもとにしています。
