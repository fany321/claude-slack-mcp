// server.js
const { WebSocketServer } = require('ws');
const { WebClient } = require('@slack/web-api');

// --- 環境変数の読み込み（Renderで設定する） ---
const PORT = process.env.PORT || 3000;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_DEFAULT_CHANNEL_NAME = process.env.SLACK_DEFAULT_CHANNEL_NAME || 'general'; // デフォルトは 'general'

if (!SLACK_BOT_TOKEN) {
  console.error('SLACK_BOT_TOKEN が設定されていません！');
  process.exit(1);
}

const slackClient = new WebClient(SLACK_BOT_TOKEN);
let defaultChannelId = null;

// --- 起動時にチャンネル名からIDを非同期で取得 ---
async function findChannelId() {
  try {
    console.log(`デフォルトチャンネル名: ${SLACK_DEFAULT_CHANNEL_NAME} のIDを検索します...`);
    const result = await slackClient.conversations.list();
    const channel = result.channels.find(c => c.name === SLACK_DEFAULT_CHANNEL_NAME);

    if (channel) {
      defaultChannelId = channel.id;
      console.log(`チャンネルIDが見つかりました: ${defaultChannelId}`);
    } else {
      console.error(`エラー: Slackチャンネル '${SLACK_DEFAULT_CHANNEL_NAME}' が見つからないか、ボットが招待されていません。`);
    }
  } catch (error) {
    console.error("Slackチャンネルの検索中にエラー:", error);
  }
}

// --- WebSocketサーバーの起動 ---
const wss = new WebSocketServer({ port: PORT }, () => {
  console.log(`MCP WebSocket Server started on port ${PORT}`);
  findChannelId(); // サーバー起動時にチャンネルIDを解決
});

// --- MCPクライアント (Claude) との通信処理 ---
wss.on('connection', ws => {
  console.log('Client (Claude) connected.');

  ws.on('message', async message => {
    console.log('Received message from client:', message.toString());
    const request = JSON.parse(message.toString());

    try {
      // 1. ツールリストの要求 (list_tools)
      if (request.method === 'list_tools') {
        ws.send(JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: [{
              tool_name: "post_slack_message",
              description: "Slackのデフォルトチャンネルにメッセージを投稿する",
              parameters: {
                type: "object",
                properties: {
                  message: { type: "string", description: "投稿するメッセージ本文" }
                },
                required: ["message"]
              }
            }]
          }
        }));
      }

      // 2. ツールの実行要求 (call_tool)
      if (request.method === 'call_tool' && request.params.tool_name === 'post_slack_message') {
        if (!defaultChannelId) {
          throw new Error("デフォルトチャンネルIDが未解決のため投稿できません。");
        }

        const userMessage = request.params.parameters.message;

        // Slack API を呼び出して投稿
        await slackClient.chat.postMessage({
          channel: defaultChannelId,
          text: userMessage
        });

        // Claudeに成功を報告
        ws.send(JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { content: `Slackの #${SLACK_DEFAULT_CHANNEL_NAME} に "${userMessage}" と投稿しました。` }
        }));
      }

    } catch (e) {
      console.error('処理エラー:', e);
      // Claudeにエラーを報告
      ws.send(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        error: { message: e.message }
      }));
    }
  });

  ws.on('close', () => console.log('Client disconnected.'));
  ws.on('error', error => console.error('WebSocket Error:', error));
});