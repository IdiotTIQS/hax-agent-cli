"use strict";

/**
 * ConversationTranslator — rule-based conversation translation engine.
 *
 * Translates agent conversations between languages using embedded
 * bilingual dictionaries and pattern matching. No external API calls.
 * Optionally consults a TranslationGlossary for domain terms.
 *
 * Supported languages: en, zh-CN, zh-TW, ja, ko, ru, fr, de, es, pt
 */

const _dicts = Symbol("dicts");
const _patterns = Symbol("patterns");
const _reverseDicts = Symbol("reverseDicts");
const _glossary = Symbol("glossary");
const _supported = Symbol("supported");

// -------------------------------------------------------------------
//  Character ranges for language detection
// -------------------------------------------------------------------

const CJK_RANGES = [
  [0x4e00, 0x9fff],   // CJK Unified Ideographs
  [0x3400, 0x4dbf],   // CJK Unified Ideographs Extension A
  [0x20000, 0x2a6df], // CJK Unified Ideographs Extension B
  [0xf900, 0xfaff],   // CJK Compatibility Ideographs
];

const HIRAGANA_RANGE = [0x3040, 0x309f];
const KATAKANA_RANGE = [0x30a0, 0x30ff];
const HANGUL_RANGE = [0xac00, 0xd7af];
const CYRILLIC_RANGE = [0x0400, 0x04ff];
const LATIN_EXTENDED_RANGE = [0x00c0, 0x024f];

// Common words per language for disambiguation
const LANG_MARKERS = {
  ja: ["です", "ます", "した", "という", "こと", "もの", "ため", "から", "まで", "ではない"],
  ko: ["합니다", "습니다", "있다", "없다", "그리고", "하지만", "에서", "으로", "에게"],
  ru: ["что", "это", "как", "для", "или", "при", "под", "над", "перед", "через"],
  fr: ["le", "la", "les", "des", "est", "pas", "dans", "avec", "pour", "sur", "une", "sont", "cette", "aussi", "être", "avoir", "fait", "plus", "bien", "leur"],
  de: ["der", "die", "das", "ist", "nicht", "und", "von", "mit", "auf", "für", "ein", "eine", "sich", "auch", "wird", "als", "nach", "bei", "aus", "zum"],
  es: ["que", "los", "las", "del", "por", "con", "para", "como", "está", "más", "una", "este", "entre", "hay", "todo", "cada", "muy", "pero", "sobre", "sin"],
  pt: ["que", "não", "para", "com", "como", "mas", "está", "são", "uma", "por", "dos", "das", "pelo", "isso", "este", "muito", "entre", "sobre", "sem", "pode"],
};

// -------------------------------------------------------------------
//  Dictionaries: English -> Target Language
// -------------------------------------------------------------------

/**
 * Build the per-language forward dictionaries.
 * Each Map<string, string> maps lowercase English -> target translation.
 * Covers UI strings, errors, programming terms, and common phrases.
 */
function buildDictionaries() {
  const dicts = {};

  // ── Simplified Chinese (zh-CN) ─────────────────────────────────
  dicts["zh-CN"] = new Map(Object.entries({
    // common
    "enabled": "已启用", "disabled": "已禁用", "set": "已设置", "not set": "未设置",
    "default": "默认", "unknown": "未知", "yes": "是", "no": "否", "usage": "用法",
    "available": "可用", "current": "当前", "standard": "标准", "auto": "自动",
    "yolo": "YOLO",
    // UI actions
    "save": "保存", "cancel": "取消", "close": "关闭", "open": "打开",
    "delete": "删除", "edit": "编辑", "copy": "复制", "paste": "粘贴",
    "search": "搜索", "filter": "筛选", "refresh": "刷新", "reset": "重置",
    "submit": "提交", "export": "导出", "import": "导入", "download": "下载",
    "upload": "上传", "preview": "预览", "help": "帮助", "settings": "设置",
    "configuration": "配置", "preferences": "偏好设置", "language": "语言",
    "theme": "主题", "profile": "个人资料", "account": "帐户",
    "send": "发送", "attach": "附加", "interrupt": "中断",
    // shell / session
    "session": "会话", "session ended": "会话已结束",
    "context cleared": "上下文已清空", "context": "上下文",
    "files modified": "文件已修改", "no response": "无回复",
    "copied to clipboard": "已复制到剪贴板", "failed to copy": "复制失败",
    "type /help": "输入 /help", "/exit to quit": "/exit 退出",
    "model": "模型", "provider": "提供商", "api key": "API 密钥",
    "api url": "API 地址", "cost": "费用", "turns": "轮次",
    "permission mode": "权限模式", "vim mode": "Vim 模式",
    "mock mode": "Mock 模式", "yolo mode": "YOLO 模式",
    // errors
    "error": "错误", "failed": "失败", "timeout": "超时",
    "connection refused": "连接被拒绝", "network error": "网络错误",
    "permission denied": "权限被拒绝", "access denied": "访问被拒绝",
    "not found": "未找到", "file not found": "文件未找到",
    "invalid input": "无效输入", "invalid argument": "无效参数",
    "type error": "类型错误", "syntax error": "语法错误",
    "out of memory": "内存不足", "unauthorized": "未授权",
    "forbidden": "禁止访问", "rate limit": "速率限制",
    "internal error": "内部错误", "unknown error": "未知错误",
    "unknown command": "未知命令", "did you mean": "你是说",
    // tools
    "file": "文件", "directory": "目录", "read": "读取", "write": "写入",
    "execute": "执行", "run": "运行", "build": "构建", "test": "测试",
    "debug": "调试", "deploy": "部署", "install": "安装",
    "uninstall": "卸载", "update": "更新", "config": "配置",
    "tool": "工具", "command": "命令", "argument": "参数",
    "option": "选项", "flag": "标志", "input": "输入", "output": "输出",
    // git
    "commit": "提交", "push": "推送", "pull": "拉取", "merge": "合并",
    "branch": "分支", "clone": "克隆", "fetch": "获取", "diff": "差异",
    "stash": "暂存", "rebase": "变基", "repository": "仓库",
    // programming
    "function": "函数", "method": "方法", "class": "类", "object": "对象",
    "instance": "实例", "interface": "接口", "module": "模块",
    "package": "包", "library": "库", "framework": "框架",
    "variable": "变量", "constant": "常量", "parameter": "参数",
    "array": "数组", "list": "列表", "map": "映射", "set": "集合",
    "queue": "队列", "stack": "堆栈", "tree": "树", "graph": "图",
    "loop": "循环", "recursion": "递归", "callback": "回调",
    "promise": "承诺", "async": "异步", "await": "等待",
    "event": "事件", "listener": "监听器", "generator": "生成器",
    "iterator": "迭代器", "decorator": "装饰器", "exception": "异常",
    "throw": "抛出", "catch": "捕获", "finally": "最终",
    "algorithm": "算法", "thread": "线程", "process": "进程",
    "server": "服务器", "client": "客户端", "database": "数据库",
    "query": "查询", "api": "接口", "endpoint": "端点",
    "token": "令牌", "cache": "缓存", "stream": "流",
    "backup": "备份", "restore": "恢复", "rollback": "回滚",
    "migration": "迁移", "template": "模板", "pipeline": "流水线",
    // phrases
    "cannot send while generating": "生成回复时无法发送",
    "press ctrl+c to exit": "按 Ctrl+C 退出",
    "start a conversation": "开始对话",
    "session named": "会话已命名",
    "check for updates": "检查更新",
    "list available": "列出可用",
    "running": "运行中", "done": "完成", "thinking": "思考中",
    "idle": "空闲", "initializing": "初始化中",
    "loading": "加载中", "processing": "处理中",
    "approved": "已批准", "denied": "已拒绝", "waiting": "等待中",
    "success": "成功", "failure": "失败",
  }));

  // ── Traditional Chinese (zh-TW) ────────────────────────────────
  dicts["zh-TW"] = new Map(Object.entries({
    "enabled": "已啟用", "disabled": "已停用", "set": "已設定", "not set": "未設定",
    "default": "預設", "unknown": "未知", "yes": "是", "no": "否", "usage": "用法",
    "available": "可用", "current": "目前", "standard": "標準", "auto": "自動",
    "yolo": "YOLO",
    "save": "儲存", "cancel": "取消", "close": "關閉", "open": "開啟",
    "delete": "刪除", "edit": "編輯", "copy": "複製", "paste": "貼上",
    "search": "搜尋", "filter": "篩選", "refresh": "重新整理", "reset": "重設",
    "submit": "提交", "export": "匯出", "import": "匯入", "download": "下載",
    "upload": "上傳", "preview": "預覽", "help": "說明", "settings": "設定",
    "configuration": "設定", "preferences": "偏好設定", "language": "語言",
    "theme": "主題", "send": "傳送", "interrupt": "中斷",
    "session": "工作階段", "session ended": "工作階段已結束",
    "context cleared": "上下文已清除", "context": "上下文",
    "files modified": "檔案已修改", "no response": "無回應",
    "copied to clipboard": "已複製到剪貼簿", "failed to copy": "複製失敗",
    "type /help": "輸入 /help", "/exit to quit": "/exit 結束",
    "model": "模型", "provider": "提供者", "api key": "API 金鑰",
    "api url": "API 網址", "cost": "費用", "turns": "回合",
    "permission mode": "權限模式", "vim mode": "Vim 模式",
    "mock mode": "模擬模式", "yolo mode": "YOLO 模式",
    "error": "錯誤", "failed": "失敗", "timeout": "逾時",
    "connection refused": "連線被拒絕", "network error": "網路錯誤",
    "permission denied": "權限被拒絕", "access denied": "存取被拒絕",
    "not found": "找不到", "file not found": "找不到檔案",
    "invalid input": "無效輸入", "invalid argument": "無效引數",
    "type error": "型別錯誤", "syntax error": "語法錯誤",
    "out of memory": "記憶體不足", "unauthorized": "未授權",
    "forbidden": "禁止", "rate limit": "速率限制",
    "internal error": "內部錯誤", "unknown error": "未知錯誤",
    "unknown command": "未知指令", "did you mean": "您是指",
    "file": "檔案", "directory": "目錄", "read": "讀取", "write": "寫入",
    "execute": "執行", "run": "執行", "build": "建置", "test": "測試",
    "debug": "偵錯", "deploy": "部署", "install": "安裝",
    "uninstall": "解除安裝", "update": "更新", "config": "設定",
    "tool": "工具", "command": "指令", "argument": "引數",
    "option": "選項", "flag": "旗標", "input": "輸入", "output": "輸出",
    "commit": "提交", "push": "推送", "pull": "拉取", "merge": "合併",
    "branch": "分支", "clone": "複製", "fetch": "擷取", "diff": "差異",
    "stash": "暫存", "rebase": "重定基底", "repository": "儲存庫",
    "function": "函式", "method": "方法", "class": "類別", "object": "物件",
    "instance": "實例", "interface": "介面", "module": "模組",
    "package": "套件", "library": "程式庫", "framework": "框架",
    "variable": "變數", "constant": "常數", "parameter": "參數",
    "array": "陣列", "list": "清單", "map": "映射", "set": "集合",
    "queue": "佇列", "stack": "堆疊", "tree": "樹", "graph": "圖",
    "loop": "迴圈", "recursion": "遞迴", "callback": "回呼",
    "promise": "承諾", "async": "非同步", "await": "等待",
    "event": "事件", "listener": "接聽器", "generator": "產生器",
    "exception": "例外", "throw": "擲出", "catch": "捕捉",
    "algorithm": "演算法", "thread": "執行緒", "process": "處理程序",
    "server": "伺服器", "client": "用戶端", "database": "資料庫",
    "query": "查詢", "api": "API", "endpoint": "端點",
    "token": "權杖", "cache": "快取", "stream": "串流",
    "backup": "備份", "restore": "還原", "rollback": "復原",
    "migration": "移轉", "template": "範本", "pipeline": "管線",
    "cannot send while generating": "產生回覆時無法傳送",
    "press ctrl+c to exit": "按 Ctrl+C 結束",
    "start a conversation": "開始對話",
    "running": "執行中", "done": "完成", "thinking": "思考中",
    "idle": "閒置", "initializing": "初始化中",
    "loading": "載入中", "processing": "處理中",
    "approved": "已核准", "denied": "已拒絕", "waiting": "等待中",
    "success": "成功", "failure": "失敗",
  }));

  // ── Japanese (ja) ──────────────────────────────────────────────
  dicts["ja"] = new Map(Object.entries({
    "enabled": "有効", "disabled": "無効", "set": "設定済み", "not set": "未設定",
    "default": "デフォルト", "unknown": "不明", "yes": "はい", "no": "いいえ",
    "usage": "使用法", "available": "利用可能", "current": "現在",
    "standard": "標準", "auto": "自動", "yolo": "YOLO",
    "save": "保存", "cancel": "キャンセル", "close": "閉じる", "open": "開く",
    "delete": "削除", "edit": "編集", "copy": "コピー", "paste": "貼り付け",
    "search": "検索", "filter": "フィルター", "refresh": "更新", "reset": "リセット",
    "submit": "送信", "export": "エクスポート", "import": "インポート",
    "download": "ダウンロード", "upload": "アップロード", "preview": "プレビュー",
    "help": "ヘルプ", "settings": "設定", "configuration": "設定",
    "language": "言語", "theme": "テーマ", "send": "送信", "interrupt": "中断",
    "session": "セッション", "session ended": "セッション終了",
    "context cleared": "コンテキストをクリア", "context": "コンテキスト",
    "files modified": "ファイル変更済み", "no response": "応答なし",
    "copied to clipboard": "クリップボードにコピー", "failed to copy": "コピー失敗",
    "type /help": "/help と入力", "/exit to quit": "/exit で終了",
    "model": "モデル", "provider": "プロバイダー", "api key": "APIキー",
    "api url": "API URL", "cost": "コスト", "turns": "ターン数",
    "permission mode": "権限モード", "vim mode": "Vimモード",
    "mock mode": "モックモード", "yolo mode": "YOLOモード",
    "error": "エラー", "failed": "失敗", "timeout": "タイムアウト",
    "connection refused": "接続拒否", "network error": "ネットワークエラー",
    "permission denied": "権限拒否", "access denied": "アクセス拒否",
    "not found": "見つかりません", "file not found": "ファイルが見つかりません",
    "invalid input": "無効な入力", "invalid argument": "無効な引数",
    "type error": "型エラー", "syntax error": "構文エラー",
    "out of memory": "メモリ不足", "unauthorized": "未認証",
    "forbidden": "禁止", "rate limit": "レート制限",
    "internal error": "内部エラー", "unknown error": "不明なエラー",
    "unknown command": "不明なコマンド", "did you mean": "もしかして",
    "file": "ファイル", "directory": "ディレクトリ", "read": "読み取り",
    "write": "書き込み", "execute": "実行", "run": "実行",
    "build": "ビルド", "test": "テスト", "debug": "デバッグ",
    "deploy": "デプロイ", "install": "インストール",
    "uninstall": "アンインストール", "update": "更新", "config": "設定",
    "tool": "ツール", "command": "コマンド", "argument": "引数",
    "option": "オプション", "flag": "フラグ", "input": "入力", "output": "出力",
    "commit": "コミット", "push": "プッシュ", "pull": "プル", "merge": "マージ",
    "branch": "ブランチ", "clone": "クローン", "fetch": "フェッチ",
    "diff": "差分", "stash": "スタッシュ", "rebase": "リベース",
    "repository": "リポジトリ",
    "function": "関数", "method": "メソッド", "class": "クラス", "object": "オブジェクト",
    "instance": "インスタンス", "interface": "インターフェース",
    "module": "モジュール", "package": "パッケージ",
    "library": "ライブラリ", "framework": "フレームワーク",
    "variable": "変数", "constant": "定数", "parameter": "パラメータ",
    "array": "配列", "list": "リスト", "map": "マップ", "set": "セット",
    "queue": "キュー", "stack": "スタック", "tree": "ツリー", "graph": "グラフ",
    "loop": "ループ", "recursion": "再帰", "callback": "コールバック",
    "promise": "プロミス", "async": "非同期", "await": "待機",
    "event": "イベント", "listener": "リスナー", "generator": "ジェネレータ",
    "exception": "例外", "throw": "スロー", "catch": "キャッチ",
    "algorithm": "アルゴリズム", "thread": "スレッド", "process": "プロセス",
    "server": "サーバー", "client": "クライアント", "database": "データベース",
    "query": "クエリ", "api": "API", "endpoint": "エンドポイント",
    "token": "トークン", "cache": "キャッシュ", "stream": "ストリーム",
    "backup": "バックアップ", "restore": "復元", "rollback": "ロールバック",
    "migration": "移行", "template": "テンプレート", "pipeline": "パイプライン",
    "cannot send while generating": "生成中は送信できません",
    "press ctrl+c to exit": "Ctrl+Cで終了",
    "start a conversation": "会話を開始",
    "running": "実行中", "done": "完了", "thinking": "思考中",
    "idle": "待機中", "initializing": "初期化中",
    "loading": "読み込み中", "processing": "処理中",
    "approved": "承認済み", "denied": "拒否", "waiting": "待機中",
    "success": "成功", "failure": "失敗",
  }));

  // ── Korean (ko) ────────────────────────────────────────────────
  dicts["ko"] = new Map(Object.entries({
    "enabled": "활성화됨", "disabled": "비활성화됨", "set": "설정됨", "not set": "설정 안 됨",
    "default": "기본값", "unknown": "알 수 없음", "yes": "예", "no": "아니요",
    "usage": "사용법", "available": "사용 가능", "current": "현재",
    "standard": "표준", "auto": "자동", "yolo": "YOLO",
    "save": "저장", "cancel": "취소", "close": "닫기", "open": "열기",
    "delete": "삭제", "edit": "편집", "copy": "복사", "paste": "붙여넣기",
    "search": "검색", "filter": "필터", "refresh": "새로고침", "reset": "초기화",
    "submit": "제출", "export": "내보내기", "import": "가져오기",
    "download": "다운로드", "upload": "업로드", "preview": "미리보기",
    "help": "도움말", "settings": "설정", "configuration": "구성",
    "language": "언어", "theme": "테마", "send": "보내기", "interrupt": "중단",
    "session": "세션", "session ended": "세션 종료됨",
    "context cleared": "컨텍스트 지워짐", "context": "컨텍스트",
    "files modified": "파일 수정됨", "no response": "응답 없음",
    "copied to clipboard": "클립보드에 복사됨", "failed to copy": "복사 실패",
    "type /help": "/help 입력", "/exit to quit": "/exit 종료",
    "model": "모델", "provider": "제공자", "api key": "API 키",
    "api url": "API URL", "cost": "비용", "turns": "턴",
    "permission mode": "권한 모드", "vim mode": "Vim 모드",
    "mock mode": "목업 모드", "yolo mode": "YOLO 모드",
    "error": "오류", "failed": "실패", "timeout": "시간 초과",
    "connection refused": "연결 거부됨", "network error": "네트워크 오류",
    "permission denied": "권한 거부됨", "access denied": "접근 거부됨",
    "not found": "찾을 수 없음", "file not found": "파일을 찾을 수 없음",
    "invalid input": "잘못된 입력", "invalid argument": "잘못된 인자",
    "type error": "타입 오류", "syntax error": "구문 오류",
    "out of memory": "메모리 부족", "unauthorized": "인증되지 않음",
    "forbidden": "금지됨", "rate limit": "속도 제한",
    "internal error": "내부 오류", "unknown error": "알 수 없는 오류",
    "unknown command": "알 수 없는 명령어", "did you mean": "혹시",
    "file": "파일", "directory": "디렉터리", "read": "읽기",
    "write": "쓰기", "execute": "실행", "run": "실행",
    "build": "빌드", "test": "테스트", "debug": "디버그",
    "deploy": "배포", "install": "설치", "uninstall": "제거",
    "update": "업데이트", "config": "설정",
    "tool": "도구", "command": "명령어", "argument": "인자",
    "option": "옵션", "flag": "플래그", "input": "입력", "output": "출력",
    "commit": "커밋", "push": "푸시", "pull": "풀", "merge": "병합",
    "branch": "브랜치", "clone": "클론", "fetch": "페치",
    "diff": "차이", "stash": "스태시", "rebase": "리베이스",
    "repository": "저장소",
    "function": "함수", "method": "메서드", "class": "클래스", "object": "객체",
    "instance": "인스턴스", "interface": "인터페이스",
    "module": "모듈", "package": "패키지",
    "library": "라이브러리", "framework": "프레임워크",
    "variable": "변수", "constant": "상수", "parameter": "매개변수",
    "array": "배열", "list": "리스트", "map": "맵", "set": "셋",
    "queue": "큐", "stack": "스택", "tree": "트리", "graph": "그래프",
    "loop": "루프", "recursion": "재귀", "callback": "콜백",
    "promise": "프로미스", "async": "비동기", "await": "대기",
    "event": "이벤트", "listener": "리스너", "generator": "제너레이터",
    "exception": "예외", "throw": "던지기", "catch": "잡기",
    "algorithm": "알고리즘", "thread": "스레드", "process": "프로세스",
    "server": "서버", "client": "클라이언트", "database": "데이터베이스",
    "query": "쿼리", "api": "API", "endpoint": "엔드포인트",
    "token": "토큰", "cache": "캐시", "stream": "스트림",
    "backup": "백업", "restore": "복원", "rollback": "롤백",
    "migration": "마이그레이션", "template": "템플릿", "pipeline": "파이프라인",
    "cannot send while generating": "생성 중에는 보낼 수 없습니다",
    "press ctrl+c to exit": "Ctrl+C로 종료",
    "start a conversation": "대화 시작",
    "running": "실행 중", "done": "완료", "thinking": "생각 중",
    "idle": "대기 중", "initializing": "초기화 중",
    "loading": "로딩 중", "processing": "처리 중",
    "approved": "승인됨", "denied": "거부됨", "waiting": "대기 중",
    "success": "성공", "failure": "실패",
  }));

  // ── Russian (ru) ───────────────────────────────────────────────
  dicts["ru"] = new Map(Object.entries({
    "enabled": "включено", "disabled": "отключено", "set": "установлено",
    "not set": "не задано", "default": "по умолчанию", "unknown": "неизвестно",
    "yes": "да", "no": "нет", "usage": "использование",
    "available": "доступно", "current": "текущий", "standard": "стандартный",
    "auto": "авто", "yolo": "YOLO",
    "save": "сохранить", "cancel": "отмена", "close": "закрыть", "open": "открыть",
    "delete": "удалить", "edit": "редактировать", "copy": "копировать",
    "paste": "вставить", "search": "поиск", "filter": "фильтр",
    "refresh": "обновить", "reset": "сброс", "submit": "отправить",
    "export": "экспорт", "import": "импорт", "download": "скачать",
    "upload": "загрузить", "preview": "предпросмотр",
    "help": "помощь", "settings": "настройки", "configuration": "конфигурация",
    "language": "язык", "theme": "тема", "send": "отправить", "interrupt": "прервать",
    "session": "сессия", "session ended": "сессия завершена",
    "context cleared": "контекст очищен", "context": "контекст",
    "files modified": "файлы изменены", "no response": "нет ответа",
    "copied to clipboard": "скопировано в буфер", "failed to copy": "не удалось скопировать",
    "type /help": "введите /help", "/exit to quit": "/exit для выхода",
    "model": "модель", "provider": "провайдер", "api key": "API-ключ",
    "api url": "API URL", "cost": "стоимость", "turns": "ходы",
    "permission mode": "режим разрешений", "vim mode": "режим Vim",
    "mock mode": "режим имитации", "yolo mode": "режим YOLO",
    "error": "ошибка", "failed": "не удалось", "timeout": "таймаут",
    "connection refused": "соединение отклонено", "network error": "сетевая ошибка",
    "permission denied": "доступ запрещён", "access denied": "доступ запрещён",
    "not found": "не найдено", "file not found": "файл не найден",
    "invalid input": "неверный ввод", "invalid argument": "неверный аргумент",
    "type error": "ошибка типа", "syntax error": "синтаксическая ошибка",
    "out of memory": "недостаточно памяти", "unauthorized": "не авторизован",
    "forbidden": "запрещено", "rate limit": "лимит запросов",
    "internal error": "внутренняя ошибка", "unknown error": "неизвестная ошибка",
    "unknown command": "неизвестная команда", "did you mean": "возможно, вы имели в виду",
    "file": "файл", "directory": "каталог", "read": "чтение",
    "write": "запись", "execute": "выполнить", "run": "запустить",
    "build": "сборка", "test": "тест", "debug": "отладка",
    "deploy": "развернуть", "install": "установить",
    "uninstall": "удалить", "update": "обновить", "config": "конфигурация",
    "tool": "инструмент", "command": "команда", "argument": "аргумент",
    "option": "опция", "flag": "флаг", "input": "ввод", "output": "вывод",
    "commit": "коммит", "push": "отправить", "pull": "получить",
    "merge": "слияние", "branch": "ветка", "clone": "клонировать",
    "fetch": "получить", "diff": "разница", "stash": "спрятать",
    "rebase": "перебазировать", "repository": "репозиторий",
    "function": "функция", "method": "метод", "class": "класс", "object": "объект",
    "instance": "экземпляр", "interface": "интерфейс",
    "module": "модуль", "package": "пакет", "library": "библиотека",
    "framework": "фреймворк", "variable": "переменная", "constant": "константа",
    "parameter": "параметр", "array": "массив", "list": "список",
    "map": "словарь", "set": "множество", "queue": "очередь",
    "stack": "стек", "tree": "дерево", "graph": "граф",
    "loop": "цикл", "recursion": "рекурсия", "callback": "обратный вызов",
    "promise": "промис", "async": "асинхронный", "await": "ожидание",
    "event": "событие", "listener": "слушатель", "generator": "генератор",
    "exception": "исключение", "throw": "бросить", "catch": "поймать",
    "algorithm": "алгоритм", "thread": "поток", "process": "процесс",
    "server": "сервер", "client": "клиент", "database": "база данных",
    "query": "запрос", "api": "API", "endpoint": "конечная точка",
    "token": "токен", "cache": "кэш", "stream": "поток",
    "backup": "резервная копия", "restore": "восстановить",
    "rollback": "откат", "migration": "миграция",
    "template": "шаблон", "pipeline": "конвейер",
    "cannot send while generating": "нельзя отправить во время генерации",
    "press ctrl+c to exit": "нажмите Ctrl+C для выхода",
    "start a conversation": "начать разговор",
    "running": "работает", "done": "готово", "thinking": "думает",
    "idle": "ожидание", "initializing": "инициализация",
    "loading": "загрузка", "processing": "обработка",
    "approved": "одобрено", "denied": "отклонено", "waiting": "ожидание",
    "success": "успех", "failure": "неудача",
  }));

  // ── French (fr) ────────────────────────────────────────────────
  dicts["fr"] = new Map(Object.entries({
    "enabled": "activé", "disabled": "désactivé", "set": "défini", "not set": "non défini",
    "default": "par défaut", "unknown": "inconnu", "yes": "oui", "no": "non",
    "usage": "utilisation", "available": "disponible", "current": "actuel",
    "standard": "standard", "auto": "auto", "yolo": "YOLO",
    "save": "enregistrer", "cancel": "annuler", "close": "fermer", "open": "ouvrir",
    "delete": "supprimer", "edit": "modifier", "copy": "copier", "paste": "coller",
    "search": "rechercher", "filter": "filtrer", "refresh": "actualiser",
    "reset": "réinitialiser", "submit": "soumettre",
    "export": "exporter", "import": "importer", "download": "télécharger",
    "upload": "téléverser", "preview": "aperçu",
    "help": "aide", "settings": "paramètres", "configuration": "configuration",
    "language": "langue", "theme": "thème", "send": "envoyer", "interrupt": "interrompre",
    "session": "session", "session ended": "session terminée",
    "context cleared": "contexte effacé", "context": "contexte",
    "files modified": "fichiers modifiés", "no response": "pas de réponse",
    "copied to clipboard": "copié dans le presse-papiers", "failed to copy": "échec de la copie",
    "type /help": "tapez /help", "/exit to quit": "/exit pour quitter",
    "model": "modèle", "provider": "fournisseur", "api key": "clé API",
    "api url": "URL API", "cost": "coût", "turns": "tours",
    "permission mode": "mode de permission", "vim mode": "mode Vim",
    "mock mode": "mode simulé", "yolo mode": "mode YOLO",
    "error": "erreur", "failed": "échoué", "timeout": "délai dépassé",
    "connection refused": "connexion refusée", "network error": "erreur réseau",
    "permission denied": "permission refusée", "access denied": "accès refusé",
    "not found": "introuvable", "file not found": "fichier introuvable",
    "invalid input": "entrée invalide", "invalid argument": "argument invalide",
    "type error": "erreur de type", "syntax error": "erreur de syntaxe",
    "out of memory": "mémoire insuffisante", "unauthorized": "non autorisé",
    "forbidden": "interdit", "rate limit": "limite de débit",
    "internal error": "erreur interne", "unknown error": "erreur inconnue",
    "unknown command": "commande inconnue", "did you mean": "vouliez-vous dire",
    "file": "fichier", "directory": "répertoire", "read": "lire",
    "write": "écrire", "execute": "exécuter", "run": "exécuter",
    "build": "compiler", "test": "tester", "debug": "déboguer",
    "deploy": "déployer", "install": "installer", "uninstall": "désinstaller",
    "update": "mettre à jour", "config": "configuration",
    "tool": "outil", "command": "commande", "argument": "argument",
    "option": "option", "flag": "drapeau", "input": "entrée", "output": "sortie",
    "commit": "valider", "push": "pousser", "pull": "tirer",
    "merge": "fusionner", "branch": "branche", "clone": "cloner",
    "fetch": "récupérer", "diff": "diff", "stash": "remiser",
    "rebase": "rebaser", "repository": "dépôt",
    "function": "fonction", "method": "méthode", "class": "classe", "object": "objet",
    "instance": "instance", "interface": "interface", "module": "module",
    "package": "paquet", "library": "bibliothèque", "framework": "cadre",
    "variable": "variable", "constant": "constante", "parameter": "paramètre",
    "array": "tableau", "list": "liste", "map": "tableau associatif",
    "set": "ensemble", "queue": "file", "stack": "pile",
    "tree": "arbre", "graph": "graphe", "loop": "boucle",
    "recursion": "récursivité", "callback": "rappel",
    "promise": "promesse", "async": "asynchrone", "await": "attendre",
    "event": "événement", "listener": "écouteur", "generator": "générateur",
    "exception": "exception", "throw": "lancer", "catch": "attraper",
    "algorithm": "algorithme", "thread": "fil d'exécution", "process": "processus",
    "server": "serveur", "client": "client", "database": "base de données",
    "query": "requête", "api": "API", "endpoint": "point de terminaison",
    "token": "jeton", "cache": "cache", "stream": "flux",
    "backup": "sauvegarde", "restore": "restaurer", "rollback": "retour en arrière",
    "migration": "migration", "template": "modèle", "pipeline": "pipeline",
    "cannot send while generating": "envoi impossible pendant la génération",
    "press ctrl+c to exit": "appuyez sur Ctrl+C pour quitter",
    "start a conversation": "démarrer une conversation",
    "running": "en cours", "done": "terminé", "thinking": "réflexion",
    "idle": "inactif", "initializing": "initialisation",
    "loading": "chargement", "processing": "traitement",
    "approved": "approuvé", "denied": "refusé", "waiting": "en attente",
    "success": "succès", "failure": "échec",
  }));

  // ── German (de) ────────────────────────────────────────────────
  dicts["de"] = new Map(Object.entries({
    "enabled": "aktiviert", "disabled": "deaktiviert", "set": "gesetzt",
    "not set": "nicht gesetzt", "default": "standard", "unknown": "unbekannt",
    "yes": "ja", "no": "nein", "usage": "verwendung",
    "available": "verfügbar", "current": "aktuell", "standard": "standard",
    "auto": "auto", "yolo": "YOLO",
    "save": "speichern", "cancel": "abbrechen", "close": "schließen", "open": "öffnen",
    "delete": "löschen", "edit": "bearbeiten", "copy": "kopieren",
    "paste": "einfügen", "search": "suchen", "filter": "filtern",
    "refresh": "aktualisieren", "reset": "zurücksetzen", "submit": "absenden",
    "export": "exportieren", "import": "importieren", "download": "herunterladen",
    "upload": "hochladen", "preview": "vorschau",
    "help": "hilfe", "settings": "einstellungen", "configuration": "konfiguration",
    "language": "sprache", "theme": "design", "send": "senden", "interrupt": "unterbrechen",
    "session": "sitzung", "session ended": "sitzung beendet",
    "context cleared": "kontext gelöscht", "context": "kontext",
    "files modified": "dateien geändert", "no response": "keine antwort",
    "copied to clipboard": "in die zwischenablage kopiert",
    "failed to copy": "kopieren fehlgeschlagen",
    "type /help": "/help eingeben", "/exit to quit": "/exit zum beenden",
    "model": "modell", "provider": "anbieter", "api key": "API-schlüssel",
    "api url": "API-URL", "cost": "kosten", "turns": "runden",
    "permission mode": "berechtigungsmodus", "vim mode": "Vim-modus",
    "mock mode": "simulationsmodus", "yolo mode": "YOLO-modus",
    "error": "fehler", "failed": "fehlgeschlagen", "timeout": "zeitüberschreitung",
    "connection refused": "verbindung abgelehnt", "network error": "netzwerkfehler",
    "permission denied": "berechtigung verweigert", "access denied": "zugriff verweigert",
    "not found": "nicht gefunden", "file not found": "datei nicht gefunden",
    "invalid input": "ungültige eingabe", "invalid argument": "ungültiges argument",
    "type error": "typfehler", "syntax error": "syntaxfehler",
    "out of memory": "arbeitsspeicher erschöpft", "unauthorized": "nicht autorisiert",
    "forbidden": "verboten", "rate limit": "ratenlimit",
    "internal error": "interner fehler", "unknown error": "unbekannter fehler",
    "unknown command": "unbekannter befehl", "did you mean": "meinten sie",
    "file": "datei", "directory": "verzeichnis", "read": "lesen",
    "write": "schreiben", "execute": "ausführen", "run": "ausführen",
    "build": "erstellen", "test": "testen", "debug": "debuggen",
    "deploy": "bereitstellen", "install": "installieren",
    "uninstall": "deinstallieren", "update": "aktualisieren", "config": "konfiguration",
    "tool": "werkzeug", "command": "befehl", "argument": "argument",
    "option": "option", "flag": "flagge", "input": "eingabe", "output": "ausgabe",
    "commit": "committen", "push": "pushen", "pull": "pullen",
    "merge": "zusammenführen", "branch": "zweig", "clone": "klonen",
    "fetch": "abrufen", "diff": "unterschied", "stash": "ablegen",
    "rebase": "umbasieren", "repository": "repository",
    "function": "funktion", "method": "methode", "class": "klasse", "object": "objekt",
    "instance": "instanz", "interface": "schnittstelle", "module": "modul",
    "package": "paket", "library": "bibliothek", "framework": "framework",
    "variable": "variable", "constant": "konstante", "parameter": "parameter",
    "array": "array", "list": "liste", "map": "zuordnungstabelle",
    "set": "menge", "queue": "warteschlange", "stack": "stapel",
    "tree": "baum", "graph": "graph", "loop": "schleife",
    "recursion": "rekursion", "callback": "rückruffunktion",
    "promise": "promise", "async": "asynchron", "await": "erwarten",
    "event": "ereignis", "listener": "zuhörer", "generator": "generator",
    "exception": "ausnahme", "throw": "werfen", "catch": "fangen",
    "algorithm": "algorithmus", "thread": "thread", "process": "prozess",
    "server": "server", "client": "client", "database": "datenbank",
    "query": "abfrage", "api": "API", "endpoint": "endpunkt",
    "token": "token", "cache": "cache", "stream": "datenstrom",
    "backup": "sicherung", "restore": "wiederherstellen",
    "rollback": "rückgängig", "migration": "migration",
    "template": "vorlage", "pipeline": "pipeline",
    "cannot send while generating": "senden während der generierung nicht möglich",
    "press ctrl+c to exit": "drücken sie Ctrl+C zum beenden",
    "start a conversation": "gespräch beginnen",
    "running": "läuft", "done": "fertig", "thinking": "denkt nach",
    "idle": "inaktiv", "initializing": "initialisierung",
    "loading": "laden", "processing": "verarbeitung",
    "approved": "genehmigt", "denied": "abgelehnt", "waiting": "warten",
    "success": "erfolg", "failure": "fehler",
  }));

  // ── Spanish (es) ───────────────────────────────────────────────
  dicts["es"] = new Map(Object.entries({
    "enabled": "activado", "disabled": "desactivado", "set": "establecido",
    "not set": "no establecido", "default": "predeterminado", "unknown": "desconocido",
    "yes": "sí", "no": "no", "usage": "uso",
    "available": "disponible", "current": "actual", "standard": "estándar",
    "auto": "auto", "yolo": "YOLO",
    "save": "guardar", "cancel": "cancelar", "close": "cerrar", "open": "abrir",
    "delete": "eliminar", "edit": "editar", "copy": "copiar", "paste": "pegar",
    "search": "buscar", "filter": "filtrar", "refresh": "actualizar",
    "reset": "restablecer", "submit": "enviar",
    "export": "exportar", "import": "importar", "download": "descargar",
    "upload": "subir", "preview": "vista previa",
    "help": "ayuda", "settings": "configuración", "configuration": "configuración",
    "language": "idioma", "theme": "tema", "send": "enviar", "interrupt": "interrumpir",
    "session": "sesión", "session ended": "sesión finalizada",
    "context cleared": "contexto borrado", "context": "contexto",
    "files modified": "archivos modificados", "no response": "sin respuesta",
    "copied to clipboard": "copiado al portapapeles", "failed to copy": "error al copiar",
    "type /help": "escribe /help", "/exit to quit": "/exit para salir",
    "model": "modelo", "provider": "proveedor", "api key": "clave API",
    "api url": "URL de API", "cost": "coste", "turns": "turnos",
    "permission mode": "modo de permisos", "vim mode": "modo Vim",
    "mock mode": "modo simulado", "yolo mode": "modo YOLO",
    "error": "error", "failed": "falló", "timeout": "tiempo de espera",
    "connection refused": "conexión rechazada", "network error": "error de red",
    "permission denied": "permiso denegado", "access denied": "acceso denegado",
    "not found": "no encontrado", "file not found": "archivo no encontrado",
    "invalid input": "entrada inválida", "invalid argument": "argumento inválido",
    "type error": "error de tipo", "syntax error": "error de sintaxis",
    "out of memory": "memoria insuficiente", "unauthorized": "no autorizado",
    "forbidden": "prohibido", "rate limit": "límite de velocidad",
    "internal error": "error interno", "unknown error": "error desconocido",
    "unknown command": "comando desconocido", "did you mean": "quisiste decir",
    "file": "archivo", "directory": "directorio", "read": "leer",
    "write": "escribir", "execute": "ejecutar", "run": "ejecutar",
    "build": "construir", "test": "probar", "debug": "depurar",
    "deploy": "desplegar", "install": "instalar", "uninstall": "desinstalar",
    "update": "actualizar", "config": "configuración",
    "tool": "herramienta", "command": "comando", "argument": "argumento",
    "option": "opción", "flag": "bandera", "input": "entrada", "output": "salida",
    "commit": "confirmar", "push": "empujar", "pull": "jalar",
    "merge": "fusionar", "branch": "rama", "clone": "clonar",
    "fetch": "obtener", "diff": "diferencia", "stash": "guardar",
    "rebase": "rebasear", "repository": "repositorio",
    "function": "función", "method": "método", "class": "clase", "object": "objeto",
    "instance": "instancia", "interface": "interfaz", "module": "módulo",
    "package": "paquete", "library": "biblioteca", "framework": "marco",
    "variable": "variable", "constant": "constante", "parameter": "parámetro",
    "array": "arreglo", "list": "lista", "map": "mapa",
    "set": "conjunto", "queue": "cola", "stack": "pila",
    "tree": "árbol", "graph": "grafo", "loop": "bucle",
    "recursion": "recursión", "callback": "retrollamada",
    "promise": "promesa", "async": "asíncrono", "await": "esperar",
    "event": "evento", "listener": "oyente", "generator": "generador",
    "exception": "excepción", "throw": "lanzar", "catch": "atrapar",
    "algorithm": "algoritmo", "thread": "hilo", "process": "proceso",
    "server": "servidor", "client": "cliente", "database": "base de datos",
    "query": "consulta", "api": "API", "endpoint": "extremo",
    "token": "token", "cache": "caché", "stream": "flujo",
    "backup": "copia de seguridad", "restore": "restaurar",
    "rollback": "reversión", "migration": "migración",
    "template": "plantilla", "pipeline": "canalización",
    "cannot send while generating": "no se puede enviar mientras se genera",
    "press ctrl+c to exit": "presiona Ctrl+C para salir",
    "start a conversation": "iniciar una conversación",
    "running": "ejecutando", "done": "hecho", "thinking": "pensando",
    "idle": "inactivo", "initializing": "inicializando",
    "loading": "cargando", "processing": "procesando",
    "approved": "aprobado", "denied": "denegado", "waiting": "esperando",
    "success": "éxito", "failure": "fallo",
  }));

  // ── Portuguese (pt) ────────────────────────────────────────────
  dicts["pt"] = new Map(Object.entries({
    "enabled": "ativado", "disabled": "desativado", "set": "definido",
    "not set": "não definido", "default": "padrão", "unknown": "desconhecido",
    "yes": "sim", "no": "não", "usage": "uso",
    "available": "disponível", "current": "atual", "standard": "padrão",
    "auto": "auto", "yolo": "YOLO",
    "save": "salvar", "cancel": "cancelar", "close": "fechar", "open": "abrir",
    "delete": "excluir", "edit": "editar", "copy": "copiar", "paste": "colar",
    "search": "pesquisar", "filter": "filtrar", "refresh": "atualizar",
    "reset": "redefinir", "submit": "enviar",
    "export": "exportar", "import": "importar", "download": "baixar",
    "upload": "carregar", "preview": "pré-visualizar",
    "help": "ajuda", "settings": "configurações", "configuration": "configuração",
    "language": "idioma", "theme": "tema", "send": "enviar", "interrupt": "interromper",
    "session": "sessão", "session ended": "sessão encerrada",
    "context cleared": "contexto limpo", "context": "contexto",
    "files modified": "arquivos modificados", "no response": "sem resposta",
    "copied to clipboard": "copiado para a área de transferência",
    "failed to copy": "falha ao copiar",
    "type /help": "digite /help", "/exit to quit": "/exit para sair",
    "model": "modelo", "provider": "provedor", "api key": "chave API",
    "api url": "URL da API", "cost": "custo", "turns": "turnos",
    "permission mode": "modo de permissão", "vim mode": "modo Vim",
    "mock mode": "modo simulado", "yolo mode": "modo YOLO",
    "error": "erro", "failed": "falhou", "timeout": "tempo esgotado",
    "connection refused": "conexão recusada", "network error": "erro de rede",
    "permission denied": "permissão negada", "access denied": "acesso negado",
    "not found": "não encontrado", "file not found": "arquivo não encontrado",
    "invalid input": "entrada inválida", "invalid argument": "argumento inválido",
    "type error": "erro de tipo", "syntax error": "erro de sintaxe",
    "out of memory": "memória insuficiente", "unauthorized": "não autorizado",
    "forbidden": "proibido", "rate limit": "limite de taxa",
    "internal error": "erro interno", "unknown error": "erro desconhecido",
    "unknown command": "comando desconhecido", "did you mean": "você quis dizer",
    "file": "arquivo", "directory": "diretório", "read": "ler",
    "write": "escrever", "execute": "executar", "run": "executar",
    "build": "compilar", "test": "testar", "debug": "depurar",
    "deploy": "implantar", "install": "instalar", "uninstall": "desinstalar",
    "update": "atualizar", "config": "configuração",
    "tool": "ferramenta", "command": "comando", "argument": "argumento",
    "option": "opção", "flag": "sinalizador", "input": "entrada", "output": "saída",
    "commit": "commitar", "push": "empurrar", "pull": "puxar",
    "merge": "mesclar", "branch": "ramo", "clone": "clonar",
    "fetch": "buscar", "diff": "diferença", "stash": "guardar",
    "rebase": "rebasear", "repository": "repositório",
    "function": "função", "method": "método", "class": "classe", "object": "objeto",
    "instance": "instância", "interface": "interface", "module": "módulo",
    "package": "pacote", "library": "biblioteca", "framework": "framework",
    "variable": "variável", "constant": "constante", "parameter": "parâmetro",
    "array": "array", "list": "lista", "map": "mapa",
    "set": "conjunto", "queue": "fila", "stack": "pilha",
    "tree": "árvore", "graph": "grafo", "loop": "laço",
    "recursion": "recursão", "callback": "retorno de chamada",
    "promise": "promessa", "async": "assíncrono", "await": "aguardar",
    "event": "evento", "listener": "ouvinte", "generator": "gerador",
    "exception": "exceção", "throw": "lançar", "catch": "capturar",
    "algorithm": "algoritmo", "thread": "thread", "process": "processo",
    "server": "servidor", "client": "cliente", "database": "banco de dados",
    "query": "consulta", "api": "API", "endpoint": "ponto de extremidade",
    "token": "token", "cache": "cache", "stream": "fluxo",
    "backup": "backup", "restore": "restaurar",
    "rollback": "reversão", "migration": "migração",
    "template": "modelo", "pipeline": "pipeline",
    "cannot send while generating": "não é possível enviar durante a geração",
    "press ctrl+c to exit": "pressione Ctrl+C para sair",
    "start a conversation": "iniciar uma conversa",
    "running": "executando", "done": "concluído", "thinking": "pensando",
    "idle": "ocioso", "initializing": "inicializando",
    "loading": "carregando", "processing": "processando",
    "approved": "aprovado", "denied": "negado", "waiting": "aguardando",
    "success": "sucesso", "failure": "falha",
  }));

  return dicts;
}

// -------------------------------------------------------------------
//  Reverse dictionaries: built lazily from forward dicts
// -------------------------------------------------------------------

function buildReverseDict(forwardDict) {
  const reverse = new Map();
  for (const [en, translated] of forwardDict) {
    if (!reverse.has(translated)) {
      reverse.set(translated, en);
    }
  }
  return reverse;
}

// -------------------------------------------------------------------
//  Pattern-based translations (for templates with variables)
// -------------------------------------------------------------------

function buildPatterns() {
  const pats = {};

  // Patterns capture strings like "Model: claude-sonnet · Provider: anthropic"
  // They use regex replace to substitute the translation while preserving variables.

  const commonPatterns = [
    // Model / Provider banner
    { en: /^Model:\s*(.+?)\s*·\s*Provider:\s*(.+)$/i,
      "zh-CN": "模型: $1 · 提供商: $2",
      "zh-TW": "模型: $1 · 提供者: $2",
      ja: "モデル: $1 · プロバイダー: $2",
      ko: "모델: $1 · 제공자: $2",
      ru: "Модель: $1 · Провайдер: $2",
      fr: "Modèle: $1 · Fournisseur: $2",
      de: "Modell: $1 · Anbieter: $2",
      es: "Modelo: $1 · Proveedor: $2",
      pt: "Modelo: $1 · Provedor: $2",
    },
    // Cost / turns
    { en: /^Cost:\s*\$(\S+)\s*·\s*Turns:\s*(\d+)$/i,
      "zh-CN": "费用: $$1 · 轮次: $2",
      "zh-TW": "費用: $$1 · 回合: $2",
      ja: "コスト: $$1 · ターン数: $2",
      ko: "비용: $$1 · 턴: $2",
      ru: "Стоимость: $$1 · Ходы: $2",
      fr: "Coût: $$1 · Tours: $2",
      de: "Kosten: $$1 · Runden: $2",
      es: "Coste: $$1 · Turnos: $2",
      pt: "Custo: $$1 · Turnos: $2",
    },
    // Context cleared
    { en: /^Context cleared\s*\((\d+)\s*messages?\)\.?$/i,
      "zh-CN": "上下文已清空（$1 条消息）",
      "zh-TW": "上下文已清除（$1 則訊息）",
      ja: "コンテキストをクリア（$1 メッセージ）",
      ko: "컨텍스트 지워짐 ($1 메시지)",
      ru: "Контекст очищен ($1 сообщений)",
      fr: "Contexte effacé ($1 messages)",
      de: "Kontext gelöscht ($1 nachrichten)",
      es: "Contexto borrado ($1 mensajes)",
      pt: "Contexto limpo ($1 mensagens)",
    },
    // Permission mode
    { en: /^Permission mode:\s*(.+)$/i,
      "zh-CN": "权限模式: $1",
      "zh-TW": "權限模式: $1",
      ja: "権限モード: $1",
      ko: "권한 모드: $1",
      ru: "Режим разрешений: $1",
      fr: "Mode de permission: $1",
      de: "Berechtigungsmodus: $1",
      es: "Modo de permisos: $1",
      pt: "Modo de permissão: $1",
    },
    // Switched language
    { en: /^Switched language to\s+(.+?)\s*\((.+?)\)\.?$/i,
      "zh-CN": "已将语言切换为 $1（$2）",
      "zh-TW": "已將語言切換為 $1（$2）",
      ja: "言語を $1（$2）に切り替えました",
      ko: "언어를 $1($2)(으)로 전환했습니다",
      ru: "Язык переключён на $1 ($2)",
      fr: "Langue changée pour $1 ($2)",
      de: "Sprache auf $1 ($2) gewechselt",
      es: "Idioma cambiado a $1 ($2)",
      pt: "Idioma alterado para $1 ($2)",
    },
    // Switched model
    { en: /^Switched model to\s+(.+)$/i,
      "zh-CN": "已切换模型为 $1",
      "zh-TW": "已切換模型為 $1",
      ja: "モデルを $1 に切り替えました",
      ko: "모델을 $1(으)로 전환했습니다",
      ru: "Модель переключена на $1",
      fr: "Modèle changé pour $1",
      de: "Modell auf $1 gewechselt",
      es: "Modelo cambiado a $1",
      pt: "Modelo alterado para $1",
    },
    // Switched provider
    { en: /^Switched provider to\s+(.+)$/i,
      "zh-CN": "已切换提供商为 $1",
      "zh-TW": "已切換提供者為 $1",
      ja: "プロバイダーを $1 に切り替えました",
      ko: "제공자를 $1(으)로 전환했습니다",
      ru: "Провайдер переключён на $1",
      fr: "Fournisseur changé pour $1",
      de: "Anbieter auf $1 gewechselt",
      es: "Proveedor cambiado a $1",
      pt: "Provedor alterado para $1",
    },
    // API key set
    { en: /^API key set for\s+(.+)\.$/i,
      "zh-CN": "已为 $1 设置 API 密钥",
      "zh-TW": "已為 $1 設定 API 金鑰",
      ja: "$1 のAPIキーを設定しました",
      ko: "$1의 API 키가 설정되었습니다",
      ru: "API-ключ установлен для $1",
      fr: "Clé API définie pour $1",
      de: "API-Schlüssel für $1 gesetzt",
      es: "Clave API establecida para $1",
      pt: "Chave API definida para $1",
    },
    // Files modified
    { en: /^Files modified this session\s*\((\d+)\):/i,
      "zh-CN": "本次会话修改的文件（$1 个）：",
      "zh-TW": "本次工作階段修改的檔案（$1 個）：",
      ja: "このセッションで変更されたファイル（$1件）：",
      ko: "이번 세션에서 수정된 파일 ($1개):",
      ru: "Файлы, изменённые в этой сессии ($1):",
      fr: "Fichiers modifiés cette session ($1):",
      de: "In dieser Sitzung geänderte Dateien ($1):",
      es: "Archivos modificados en esta sesión ($1):",
      pt: "Arquivos modificados nesta sessão ($1):",
    },
    // Unknown command
    { en: /^Unknown command:\s*\/?(.+)$/i,
      "zh-CN": "未知命令: $1",
      "zh-TW": "未知指令: $1",
      ja: "不明なコマンド: $1",
      ko: "알 수 없는 명령어: $1",
      ru: "Неизвестная команда: $1",
      fr: "Commande inconnue: $1",
      de: "Unbekannter Befehl: $1",
      es: "Comando desconocido: $1",
      pt: "Comando desconhecido: $1",
    },
    // Session named
    { en: /^Session named:\s*(.+)$/i,
      "zh-CN": "会话已命名: $1",
      "zh-TW": "工作階段已命名: $1",
      ja: "セッション名: $1",
      ko: "세션 이름: $1",
      ru: "Сессия названа: $1",
      fr: "Session nommée: $1",
      de: "Sitzung benannt: $1",
      es: "Sesión nombrada: $1",
      pt: "Sessão nomeada: $1",
    },
    // Vim mode
    { en: /^Vim mode\s+(.+?)\.?$/i,
      "zh-CN": "Vim 模式 $1",
      "zh-TW": "Vim 模式 $1",
      ja: "Vimモード $1",
      ko: "Vim 모드 $1",
      ru: "Режим Vim $1",
      fr: "Mode Vim $1",
      de: "Vim-Modus $1",
      es: "Modo Vim $1",
      pt: "Modo Vim $1",
    },
    // Current language
    { en: /^Current language:\s*(.+?)\s*\((.+?)\)/i,
      "zh-CN": "当前语言: $1（$2）",
      "zh-TW": "目前語言: $1（$2）",
      ja: "現在の言語: $1（$2）",
      ko: "현재 언어: $1($2)",
      ru: "Текущий язык: $1 ($2)",
      fr: "Langue actuelle: $1 ($2)",
      de: "Aktuelle Sprache: $1 ($2)",
      es: "Idioma actual: $1 ($2)",
      pt: "Idioma atual: $1 ($2)",
    },
    // Current provider
    { en: /^Current provider:\s*(.+)$/i,
      "zh-CN": "当前提供商: $1",
      "zh-TW": "目前提供者: $1",
      ja: "現在のプロバイダー: $1",
      ko: "현재 제공자: $1",
      ru: "Текущий провайдер: $1",
      fr: "Fournisseur actuel: $1",
      de: "Aktueller Anbieter: $1",
      es: "Proveedor actual: $1",
      pt: "Provedor atual: $1",
    },
    // Current model
    { en: /^Current model:\s*(.+)$/i,
      "zh-CN": "当前模型: $1",
      "zh-TW": "目前模型: $1",
      ja: "現在のモデル: $1",
      ko: "현재 모델: $1",
      ru: "Текущая модель: $1",
      fr: "Modèle actuel: $1",
      de: "Aktuelles Modell: $1",
      es: "Modelo actual: $1",
      pt: "Modelo atual: $1",
    },
    // API key status
    { en: /^API key:\s*(.+)$/i,
      "zh-CN": "API 密钥: $1",
      "zh-TW": "API 金鑰: $1",
      ja: "APIキー: $1",
      ko: "API 키: $1",
      ru: "API-ключ: $1",
      fr: "Clé API: $1",
      de: "API-Schlüssel: $1",
      es: "Clave API: $1",
      pt: "Chave API: $1",
    },
    // Session stats
    { en: /^Cost:\s*\$(\S+)\s*·\s*Turns:\s*(\S+)$/i,
      "zh-CN": "费用: $$1 · 轮次: $2",
      "zh-TW": "費用: $$1 · 回合: $2",
      ja: "コスト: $$1 · ターン数: $2",
      ko: "비용: $$1 · 턴: $2",
      ru: "Стоимость: $$1 · Ходы: $2",
      fr: "Coût: $$1 · Tours: $2",
      de: "Kosten: $$1 · Runden: $2",
      es: "Coste: $$1 · Turnos: $2",
      pt: "Custo: $$1 · Turnos: $2",
    },
  ];

  // Organize patterns by language
  for (const pat of commonPatterns) {
    for (const lang of Object.keys(pat)) {
      if (lang === "en") continue;
      if (!pats[lang]) pats[lang] = [];
      pats[lang].push({ regex: pat.en, replacement: pat[lang] });
    }
  }

  return pats;
}

// -------------------------------------------------------------------
//  ConversationTranslator
// -------------------------------------------------------------------

class ConversationTranslator {
  /**
   * @param {object} [options]
   * @param {import('./glossary').TranslationGlossary} [options.glossary] - optional glossary
   */
  constructor(options = {}) {
    this[_glossary] = options.glossary || null;
    this[_supported] = Object.freeze([
      "en", "zh-CN", "zh-TW", "ja", "ko", "ru", "fr", "de", "es", "pt",
    ]);

    this[_dicts] = buildDictionaries();
    this[_patterns] = buildPatterns();

    // Build reverse dicts lazily on first use
    this[_reverseDicts] = {};
  }

  // ---------------------------------------------------------------
  //  Primary translation
  // ---------------------------------------------------------------

  /**
   * Translate text from one language to another.
   * Uses dictionary lookup, pattern matching, glossary consultation,
   * and word-by-word fallback.
   *
   * @param {string} text - the text to translate
   * @param {string} from - source language code (auto-detect if empty/"auto")
   * @param {string} to - target language code
   * @returns {string} translated text
   */
  translate(text, from, to) {
    if (typeof text !== "string" || text.length === 0) return text;

    // Resolve source language
    const sourceLang = (!from || from === "auto") ? this.detectLanguage(text) : from;
    const targetLang = to;

    if (sourceLang === targetLang) return text;

    // Case 1: English -> target (direct dictionary lookup)
    if (sourceLang === "en") {
      return this._translateEnTo(text, targetLang);
    }

    // Case 2: Target -> English (reverse lookup)
    if (targetLang === "en") {
      return this._translateToEn(text, sourceLang);
    }

    // Case 3: Non-English -> Non-English: pivot through English
    const english = this._translateToEn(text, sourceLang);
    return this._translateEnTo(english, targetLang);
  }

  /**
   * Translate an entire message object.
   * Message format: { role: string, content: string|array }
   * Content arrays support [{type: "text", text: "..."}, ...]
   *
   * @param {object} message - message to translate
   * @param {string} to - target language code
   * @returns {object} new message object with translated content
   */
  translateMessage(message, to) {
    if (!message || typeof message !== "object") return message;

    const translated = Object.assign({}, message);

    if (typeof message.content === "string") {
      translated.content = this.translate(message.content, "auto", to);
    } else if (Array.isArray(message.content)) {
      translated.content = message.content.map((block) => {
        if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
          return Object.assign({}, block, {
            text: this.translate(block.text, "auto", to),
          });
        }
        return block;
      });
    }

    return translated;
  }

  /**
   * Translate an entire session (array of messages).
   * Each message follows: { role: string, content: string|array }
   *
   * @param {object|Array} session - session object with messages array, or messages array directly
   * @param {string} to - target language code
   * @returns {object|Array} translated session
   */
  translateSession(session, to) {
    if (Array.isArray(session)) {
      return session.map((msg) => this.translateMessage(msg, to));
    }

    if (session && typeof session === "object") {
      const translated = Object.assign({}, session);
      if (Array.isArray(session.messages)) {
        translated.messages = session.messages.map((msg) => this.translateMessage(msg, to));
      }
      if (typeof session.systemPrompt === "string") {
        translated.systemPrompt = this.translate(session.systemPrompt, "auto", to);
      }
      return translated;
    }

    return session;
  }

  // ---------------------------------------------------------------
  //  Language detection
  // ---------------------------------------------------------------

  /**
   * Detect the language of a given text.
   * Uses character-set analysis, word markers, and scoring.
   *
   * @param {string} text - text to analyze
   * @returns {string} detected language code (defaults to "en")
   */
  detectLanguage(text) {
    if (!text || typeof text !== "string" || text.trim().length === 0) return "en";

    const scores = {};

    // Count characters in each script
    let cjk = 0, hiragana = 0, katakana = 0, hangul = 0, cyrillic = 0, latinExt = 0, total = 0;

    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (!cp) continue;
      total++;

      if (CJK_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) cjk++;
      if (cp >= HIRAGANA_RANGE[0] && cp <= HIRAGANA_RANGE[1]) hiragana++;
      if (cp >= KATAKANA_RANGE[0] && cp <= KATAKANA_RANGE[1]) katakana++;
      if (cp >= HANGUL_RANGE[0] && cp <= HANGUL_RANGE[1]) hangul++;
      if (cp >= CYRILLIC_RANGE[0] && cp <= CYRILLIC_RANGE[1]) cyrillic++;
      if (cp >= LATIN_EXTENDED_RANGE[0] && cp <= LATIN_EXTENDED_RANGE[1]) latinExt++;
    }

    if (total === 0) return "en";

    // High-confidence script-based detection
    const cjkRatio = cjk / total;
    const hangulRatio = hangul / total;
    const cyrillicRatio = cyrillic / total;
    const jaRatio = (hiragana + katakana) / total;

    // Korean: significant Hangul
    if (hangulRatio > 0.1) {
      scores["ko"] = hangulRatio * 100;
    }

    // Japanese: has Hiragana/Katakana
    if (jaRatio > 0.05) {
      scores["ja"] = jaRatio * 100 + cjkRatio * 50;
    }

    // Russian: significant Cyrillic
    if (cyrillicRatio > 0.15) {
      scores["ru"] = cyrillicRatio * 100;
    }

    // Chinese: CJK with no Hiragana/Katakana/Hangul
    if (cjkRatio > 0.1 && jaRatio < 0.03 && hangulRatio < 0.03) {
      // Simplified vs Traditional: check a few character differences
      // This is a heuristic; Traditional Chinese uses characters like 會, 體, 國 etc.
      let traditionalMarkers = 0;
      let simplifiedMarkers = 0;
      const tradSet = new Set("會體國學對機開關頭電風飛馬魚龍門點書長見貝");
      const simpSet = new Set("会体国学对机开关头电风飞马鱼龙门点书长见贝");
      for (const ch of text) {
        if (tradSet.has(ch)) traditionalMarkers++;
        if (simpSet.has(ch)) simplifiedMarkers++;
      }

      if (traditionalMarkers > simplifiedMarkers) {
        scores["zh-TW"] = cjkRatio * 100;
      } else {
        scores["zh-CN"] = cjkRatio * 100;
      }
    }

    // Word-based detection for Latin-script languages
    const words = text.toLowerCase().match(/[\wÀ-ɏ]+/g) || [];
    const wordCount = words.length;

    if (wordCount > 2) {
      for (const [lang, markers] of Object.entries(LANG_MARKERS)) {
        let matchCount = 0;
        for (const word of words) {
          if (markers.includes(word)) matchCount++;
        }
        const ratio = matchCount / Math.min(wordCount, 20);
        if (ratio > 0.05) {
          scores[lang] = (scores[lang] || 0) + ratio * 80;
        }
      }
    }

    // Disambiguate Romance languages using character-level patterns
    if (scores["pt"] || scores["es"] || scores["fr"]) {
      const ptDistinct = (text.match(/[ãõç]/g) || []).length;
      const esDistinct = (text.match(/[ñü]/g) || []).length;
      const frDistinct = (text.match(/[èêëîïùû]/g) || []).length;
      if (ptDistinct > 0) scores["pt"] = (scores["pt"] || 0) + ptDistinct * 20;
      if (esDistinct > 0) scores["es"] = (scores["es"] || 0) + esDistinct * 20;
      if (frDistinct > 0) scores["fr"] = (scores["fr"] || 0) + frDistinct * 20;
    }

    // Fallback: if no strong signal, assume English
    if (Object.keys(scores).length === 0) return "en";

    // Return the language with the highest score
    let best = "en";
    let bestScore = 0;
    for (const [lang, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        best = lang;
      }
    }

    return best;
  }

  /**
   * Get the list of supported language codes.
   * @returns {string[]}
   */
  getSupportedLanguages() {
    return Array.from(this[_supported]);
  }

  /**
   * Check whether a language code is supported.
   * @param {string} lang
   * @returns {boolean}
   */
  isSupported(lang) {
    return this[_supported].includes(lang);
  }

  // ---------------------------------------------------------------
  //  Internal: English -> Target
  // ---------------------------------------------------------------

  /**
   * @private
   * Translate English text to a target language.
   */
  _translateEnTo(text, targetLang) {
    const dict = this[_dicts][targetLang];
    const patterns = this[_patterns][targetLang] || [];

    // Step 1: Try pattern-based translation first (handles templated strings)
    for (const { regex, replacement } of patterns) {
      const match = regex.exec(text);
      if (match) {
        return text.replace(regex, replacement);
      }
    }

    // Step 2: Word-by-word/phrase-by-phrase translation
    // We tokenize on word boundaries and translate each token
    return this._translateTokens(text, dict, targetLang);
  }

  /**
   * @private
   * Translate text token by token using the dictionary.
   * Handles multi-word phrases, case preservation, and punctuation.
   */
  _translateTokens(text, dict, targetLang) {
    // Try longer phrase matches first, then fall back to word-level
    let result = text;

    // Sort dictionary keys by length (longest first) for greedy phrase matching
    const sortedPhrases = Array.from(dict.keys()).sort((a, b) => {
      const lenDiff = b.length - a.length;
      if (lenDiff !== 0) return lenDiff;
      // Among same length, prefer those with spaces (phrases over single words)
      return (b.includes(" ") ? 1 : 0) - (a.includes(" ") ? 1 : 0);
    });

    // Case-insensitive phrase matching preserving original case pattern
    for (const phrase of sortedPhrases) {
      if (phrase.length < 2) continue; // skip single chars
      const regex = new RegExp(
        phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "gi"
      );
      result = result.replace(regex, (match) => {
        // Consult glossary first for domain-specific terms
        const glossaryTranslation = this._lookupGlossary(match, targetLang);
        if (glossaryTranslation) return glossaryTranslation;

        const translation = dict.get(match.toLowerCase()) || dict.get(phrase) || match;
        return this._preserveCase(match, translation);
      });
    }

    // Check glossary for the whole text as a single phrase
    const glossaryCheck = this._lookupGlossary(text, targetLang);
    if (glossaryCheck && glossaryCheck !== text) {
      return glossaryCheck;
    }

    return result;
  }

  /**
   * @private
   * Consult the optional glossary for a term translation.
   */
  _lookupGlossary(term, lang) {
    if (!this[_glossary]) return null;
    return this[_glossary].lookup(term, lang);
  }

  /**
   * @private
   * Preserve the original case pattern in the translated word.
   */
  _preserveCase(source, translation) {
    if (!source || !translation) return translation;

    if (source === source.toUpperCase()) {
      return translation.toUpperCase();
    }
    if (source[0] === source[0].toUpperCase() && source.slice(1) === source.slice(1).toLowerCase()) {
      return translation[0].toUpperCase() + translation.slice(1);
    }
    return translation;
  }

  // ---------------------------------------------------------------
  //  Internal: Target -> English
  // ---------------------------------------------------------------

  /**
   * @private
   * Translate from a target language back to English.
   */
  _translateToEn(text, sourceLang) {
    // Build reverse dictionary lazily
    if (!this[_reverseDicts][sourceLang]) {
      this[_reverseDicts][sourceLang] = buildReverseDict(this[_dicts][sourceLang]);
    }

    const reverseDict = this[_reverseDicts][sourceLang];
    const patterns = this[_patterns][sourceLang] || [];

    // Step 1: Try to reverse-match patterns
    for (const { regex, replacement } of patterns) {
      const match = regex.exec(text);
      if (match) {
        // For reverse, we don't have reverse patterns easily, skip pattern translation
        // and rely on word/phrase lookup
      }
    }

    // Step 2: Phrase-by-phrase reverse lookup
    let result = text;
    const sortedPhrases = Array.from(reverseDict.keys()).sort((a, b) => b.length - a.length);

    for (const phrase of sortedPhrases) {
      if (phrase.length < 2) continue;
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "g");
      result = result.replace(regex, (match) => {
        return reverseDict.get(match) || match;
      });
    }

    return result;
  }
}

module.exports = { ConversationTranslator };
