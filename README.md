# こうかんノート（独立Webアプリ版）

友達と共有する日記アプリです。Claudeアカウントは不要で、メールアドレスとパスワードだけで参加できます。

## 使っている技術

- **Next.js**（フロントエンド）
- **Supabase**（メール/パスワード認証・データベース・リアルタイム同期、無料枠で運用可能）
- **Vercel**（ホスティング、GitHub連携で自動デプロイ、無料枠で運用可能）

## セットアップ手順

### 1. Supabaseプロジェクトを作る
1. https://supabase.com で無料アカウントを作り、新規プロジェクトを作成
2. 左メニューの **SQL Editor** を開き、`supabase/schema.sql` の中身を貼り付けて実行
3. **Project Settings > API** から `Project URL` と `anon public key` をコピー

### 2. 環境変数を設定する
`.env.local.example` を `.env.local` にコピーし、値を埋める。

```bash
cp .env.local.example .env.local
```

`NEXT_PUBLIC_INVITE_CODE` は、友達以外が勝手にアカウントを作れないようにするための合言葉です（任意）。本格的なセキュリティではなく簡易的な仕切りなので、本当に外部に漏らしたくない内容は書かない前提で使ってください。

### 3. ローカルで動作確認
```bash
npm install
npm run dev
```
http://localhost:3000 を開いて、サインアップ→ログイン→投稿ができるか確認します。

### 4. GitHubにアップロード
```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin <あなたのGitHubリポジトリURL>
git push -u origin main
```

### 5. Vercelでデプロイ
1. https://vercel.com でGitHubアカウント連携し、このリポジトリをインポート
2. Vercelの **Environment Variables** に `.env.local` と同じ内容を設定
3. Deployを押すと、数十秒で公開URLが発行される（以後、GitHubのmainブランチにpushするたびに自動で再デプロイされます）

これで、友達は発行されたURLを開いてメールアドレスで参加でき、Claudeアカウントは一切不要です。

## 今後の改修をClaudeと進める方法

このチャット（claude.ai）でもコードの相談はできますが、実際にリポジトリを継続的に更新していく作業には **Claude Code** が向いています。

1. Claude Codeをインストール（ターミナル版、VS Code拡張、またはデスクトップアプリ）
2. このプロジェクトのフォルダを開く
3. 「コメントに絵文字リアクションを追加して」のように自然言語で指示する
4. Claude Codeがコードを編集 → 動作確認 → `git commit` / `git push`
5. Vercelが自動で再デプロイし、友達が見ている画面にも反映される

チーム開発のイメージとしては「GitHubリポジトリが本体、Vercelが公開先、Claude Codeが開発者」という役割分担になります。
