# CSVレスキュー — AdSense品質改善版（2026-10-24）

## この版の変更点
- 「このサイトについて」ページに、目的・機能・対応範囲・制限・サンプル・運営連絡先の説明を追加
- 文字化け・重複削除・列ズレの解説記事を、入力例・確認手順・結果の読み方を使って拡充
- `sample-duplicates-check.csv` と `sample-columns-check.csv` を追加。記事からダウンロードして試せます
- トップページに初心者向けの3ステップを追加
- 記事から実際に移動するサイト内リンクを、Cloudflare Pagesの拡張子なしURLに統一
- canonicalリンクと既存サイトマップ（拡張子なしURL）の整合性を改善
- プライバシーポリシーの広告表現をサイト審査中も正確な表現へ調整、最終更新日を明記
- 問い合わせで必要な再現情報を明記
- `app.js`, `compare-core.js`, `compare-ui.js`, `ads.txt` は前のv6 SEO版から**変更なし**
- AdSense ID `ca-pub-9713647473376060` とトップページのGoogle Search Console所有権確認タグを維持

## GitHubに反映する方法（ブラウザ）
1. 既存リポジトリ `https://github.com/rexsf7/csv-rescue-tool` の「Code」→「Download ZIP」でバックアップ。
2. この更新ZIPを**PC上で解凍**。
3. GitHubリポジトリのトップで「Add file」→「Upload files」。
4. 解凍したフォルダ内の**ファイル全部（ZIPファイル自体ではない）**を選び、アップロード。ルート階層に置く（サブフォルダを作らない）。
5. Commit changes を押す。Cloudflare PagesがGitHub連携で更新されるまで待つ。
6. 公開ページのトップ・3記事・about・privacy をチェックし、サンプルCSVがダウンロードできることを確認。
7. Search Consoleでトップと新しい記事のクロール状況を確認。修正済みでも再クロールには時間がかかります。
8. Googleの審査基準と公開ページを点検した上で、AdSense「サイト」から再審査を依頼。

## 動作確認の例
- トップ：`sample.csv` を読み込んで「CSVを診断する」が動くこと。
- 重複：`sample-duplicates-check.csv` を診断。行全体の完全一致は削除対象1行、前後の空白を削除すると削除対象が追加されること。
- 列数：`sample-columns-check.csv` を診断。3列の見出しに対して2列と4列のデータ行を検出すること。
- 差分：`sample-before.csv` と `sample-after.csv` を従来通り比較できること。
- この改善だけでAdSense審査合格、アクセス増加、収益が保証されるものではありません。

## 注意
今回のZIPは**完成サイト一式**です。解凍後、同名のファイルを上書きしてGitHubにアップロードしてください。CSS・JS・サンプルもルート階層に置く必要があります。元のリポジトリにこの作業より新しい独自変更がある場合は、上書きする前に差分を確認してください。
