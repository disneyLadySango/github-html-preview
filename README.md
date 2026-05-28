# GitHub HTML Preview

GitHub の `.html` / `.htm` ファイル表示ページで、HTMLを簡易プレビューするための Chrome 拡張です。

対象URLの例:

```text
https://github.com/{owner}/{repo}/blob/{branch}/path/to/file.html
```

## できること

- GitHub の `.html` / `.htm` blobページに `Preview HTML` ボタンを追加します。
- ボタンを押すと、拡張のプレビュー画面を新しいタブで開きます。
- GitHub上に表示されているHTMLソースを読み取り、sandbox iframe内で描画します。
- inline CSS はデフォルトで反映します。
- inline JavaScript はデフォルト無効です。`Run scripts` を押した場合だけ実行します。
- preview内の `.html` / `.htm` リンクは、同じpreviewタブ内で開きます。
- GitHubのSPA遷移後も、HTMLファイルページでボタンが出るようにしています。
- private repoでも、ブラウザで閲覧権限があるHTMLファイルならpreviewできます。

## Chromeへの読み込み手順

1. `chrome://extensions` を開きます。
2. 右上の `Developer mode` をONにします。
3. `Load unpacked` をクリックします。
4. このフォルダを選択します: `github-html-preview-extension`
5. GitHubで `.html` または `.htm` ファイルのページを開きます。
6. `Preview HTML` をクリックします。

`manifest.json` を変更した後は、拡張を削除してから `Load unpacked` し直すのが確実です。

## 社内利用時の注意

この拡張は、GitHub上で本人が閲覧できるHTMLファイルだけをpreview対象にします。private repoの内容を自動で公開するものではありません。

ただし、HTMLファイルの内容はpreviewのために一時的に拡張内で扱われます。

- HTML本文は `chrome.storage.session` に一時保存されます。
- 拡張はHTML本文を独自の外部サーバーへ送信しません。
- inline JavaScriptはデフォルトでは実行しません。
- `Run scripts` を押すと、そのHTML内のinline JavaScriptが実行されます。
- 機密情報を含むHTMLで `Run scripts` を押す場合は、そのHTMLの内容を信頼できる時だけにしてください。
- 外部scriptとiframeはMVPでは無効化しています。

## セキュリティモデル

デフォルトでは、HTML/CSS中心の静的previewとして動作します。

- `<style>...</style>` は有効です。
- `<script>...</script>` は初期表示では無効です。
- `Run scripts` を押すと、inline scriptだけを有効にして再描画します。
- `<script src="...">` は無効化します。
- `<iframe>` は無効化し、placeholderに置き換えます。
- 外部CSSは可能な範囲でfetchしてinline化します。

private repoのHTMLをpreviewする場合でも、拡張が勝手にrepo内容を公開するわけではありません。一方で、`Run scripts` 実行後のinline JavaScriptは通常のJavaScriptとして動くため、悪意あるHTMLであれば外部通信を行う可能性があります。

## ファイル構成

- `manifest.json`: Manifest V3 の拡張設定です。
- `background.js`: previewタブを開き、HTML本文を一時保存します。
- `content-script.js`: GitHubページ上でHTMLファイルを検出し、`Preview HTML` ボタンを追加します。
- `preview.html`: 拡張側のpreview画面です。
- `preview.js`: HTMLの読み込み、整形、rendererへの受け渡しを行います。
- `preview.css`: preview画面のスタイルです。
- `renderer.html` / `renderer.js`: 対象HTMLを描画するsandbox iframeです。
- `examples/inline.html`: inline CSS / inline JavaScript の動作確認用HTMLです。

## デバッグ

DevToolsで `GitHub HTML Preview` を検索すると、関連ログを絞り込めます。

- GitHub blobページ: `[GitHub HTML Preview][content]`
- 拡張のService Worker: `[GitHub HTML Preview][background]`
- previewタブ: `[GitHub HTML Preview][preview]`
- preview iframe: `[GitHub HTML Preview][renderer]`

## MVPの制限

- Chrome Web Store公開用の審査対応はまだしていません。
- 外部scriptは無効です。
- iframeは無効です。
- JavaScript実行はinline scriptのみ、かつ `Run scripts` 押下後だけです。
- private repo対応は、ログイン済みChromeでGitHubページを閲覧できることが前提です。
- 複雑なSPAやビルド済みWebアプリの完全再現は対象外です。
