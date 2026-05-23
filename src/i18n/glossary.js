"use strict";

/**
 * TranslationGlossary — manages term translations across languages.
 *
 * Pre-loaded with 200+ common programming terms in 5 languages
 * (zh-CN, ja, ru, es, fr). Supports adding, looking up, importing
 * from JSON, and exporting to JSON.
 *
 * Categories: UI, Errors, Tools, Commands, General Programming
 */

const fs = require("node:fs");
const path = require("node:path");

const _terms = Symbol("terms");
const _langs = Symbol("langs");

class TranslationGlossary {
  constructor() {
    /** @type {Map<string, Map<string, string>>}  sourceTerm -> Map<lang, translation> */
    this[_terms] = new Map();
    /** @type {Set<string>} */
    this[_langs] = new Set(["en", "zh-CN", "ja", "ru", "es", "fr"]);

    this._preloadDefaults();
  }

  // ---------------------------------------------------------------
  //  Pre-loaded terms (200+ across 5 languages, 5 categories)
  // ---------------------------------------------------------------

  /** @private */
  _preloadDefaults() {
    const defaults = [
      // ── UI ────────────────────────────────────────────────────
      { en: "Settings", zhCN: "设置", ja: "設定", ru: "Настройки", es: "Configuración", fr: "Paramètres" },
      { en: "Preferences", zhCN: "偏好设置", ja: "環境設定", ru: "Предпочтения", es: "Preferencias", fr: "Préférences" },
      { en: "Configuration", zhCN: "配置", ja: "構成", ru: "Конфигурация", es: "Configuración", fr: "Configuration" },
      { en: "Language", zhCN: "语言", ja: "言語", ru: "Язык", es: "Idioma", fr: "Langue" },
      { en: "Theme", zhCN: "主题", ja: "テーマ", ru: "Тема", es: "Tema", fr: "Thème" },
      { en: "Save", zhCN: "保存", ja: "保存", ru: "Сохранить", es: "Guardar", fr: "Enregistrer" },
      { en: "Cancel", zhCN: "取消", ja: "キャンセル", ru: "Отмена", es: "Cancelar", fr: "Annuler" },
      { en: "Close", zhCN: "关闭", ja: "閉じる", ru: "Закрыть", es: "Cerrar", fr: "Fermer" },
      { en: "Open", zhCN: "打开", ja: "開く", ru: "Открыть", es: "Abrir", fr: "Ouvrir" },
      { en: "Search", zhCN: "搜索", ja: "検索", ru: "Поиск", es: "Buscar", fr: "Rechercher" },
      { en: "Filter", zhCN: "筛选", ja: "フィルター", ru: "Фильтр", es: "Filtrar", fr: "Filtrer" },
      { en: "Refresh", zhCN: "刷新", ja: "更新", ru: "Обновить", es: "Actualizar", fr: "Actualiser" },
      { en: "Loading", zhCN: "加载中", ja: "読み込み中", ru: "Загрузка", es: "Cargando", fr: "Chargement" },
      { en: "Submit", zhCN: "提交", ja: "送信", ru: "Отправить", es: "Enviar", fr: "Soumettre" },
      { en: "Reset", zhCN: "重置", ja: "リセット", ru: "Сброс", es: "Restablecer", fr: "Réinitialiser" },
      { en: "Delete", zhCN: "删除", ja: "削除", ru: "Удалить", es: "Eliminar", fr: "Supprimer" },
      { en: "Edit", zhCN: "编辑", ja: "編集", ru: "Редактировать", es: "Editar", fr: "Modifier" },
      { en: "Copy", zhCN: "复制", ja: "コピー", ru: "Копировать", es: "Copiar", fr: "Copier" },
      { en: "Paste", zhCN: "粘贴", ja: "貼り付け", ru: "Вставить", es: "Pegar", fr: "Coller" },
      { en: "Cut", zhCN: "剪切", ja: "切り取り", ru: "Вырезать", es: "Cortar", fr: "Couper" },
      { en: "Undo", zhCN: "撤销", ja: "元に戻す", ru: "Отменить", es: "Deshacer", fr: "Annuler" },
      { en: "Redo", zhCN: "重做", ja: "やり直す", ru: "Повторить", es: "Rehacer", fr: "Rétablir" },
      { en: "Export", zhCN: "导出", ja: "エクスポート", ru: "Экспорт", es: "Exportar", fr: "Exporter" },
      { en: "Import", zhCN: "导入", ja: "インポート", ru: "Импорт", es: "Importar", fr: "Importer" },
      { en: "Download", zhCN: "下载", ja: "ダウンロード", ru: "Скачать", es: "Descargar", fr: "Télécharger" },
      { en: "Upload", zhCN: "上传", ja: "アップロード", ru: "Загрузить", es: "Subir", fr: "Téléverser" },
      { en: "Preview", zhCN: "预览", ja: "プレビュー", ru: "Предпросмотр", es: "Vista previa", fr: "Aperçu" },
      { en: "Help", zhCN: "帮助", ja: "ヘルプ", ru: "Помощь", es: "Ayuda", fr: "Aide" },
      { en: "About", zhCN: "关于", ja: "について", ru: "О программе", es: "Acerca de", fr: "À propos" },
      { en: "Version", zhCN: "版本", ja: "バージョン", ru: "Версия", es: "Versión", fr: "Version" },
      { en: "Status", zhCN: "状态", ja: "状態", ru: "Статус", es: "Estado", fr: "Statut" },
      { en: "Progress", zhCN: "进度", ja: "進行状況", ru: "Прогресс", es: "Progreso", fr: "Progression" },
      { en: "Notification", zhCN: "通知", ja: "通知", ru: "Уведомление", es: "Notificación", fr: "Notification" },
      { en: "Warning", zhCN: "警告", ja: "警告", ru: "Предупреждение", es: "Advertencia", fr: "Avertissement" },
      { en: "Information", zhCN: "信息", ja: "情報", ru: "Информация", es: "Información", fr: "Information" },
      { en: "Confirmation", zhCN: "确认", ja: "確認", ru: "Подтверждение", es: "Confirmación", fr: "Confirmation" },
      { en: "Dashboard", zhCN: "仪表板", ja: "ダッシュボード", ru: "Панель", es: "Panel", fr: "Tableau de bord" },
      { en: "Log", zhCN: "日志", ja: "ログ", ru: "Журнал", es: "Registro", fr: "Journal" },
      { en: "Profile", zhCN: "个人资料", ja: "プロフィール", ru: "Профиль", es: "Perfil", fr: "Profil" },
      { en: "Account", zhCN: "帐户", ja: "アカウント", ru: "Аккаунт", es: "Cuenta", fr: "Compte" },
      { en: "Password", zhCN: "密码", ja: "パスワード", ru: "Пароль", es: "Contraseña", fr: "Mot de passe" },
      { en: "Username", zhCN: "用户名", ja: "ユーザー名", ru: "Имя пользователя", es: "Usuario", fr: "Nom d'utilisateur" },
      { en: "Enabled", zhCN: "已启用", ja: "有効", ru: "Включено", es: "Activado", fr: "Activé" },
      { en: "Disabled", zhCN: "已禁用", ja: "無効", ru: "Отключено", es: "Desactivado", fr: "Désactivé" },
      { en: "Default", zhCN: "默认", ja: "デフォルト", ru: "По умолчанию", es: "Predeterminado", fr: "Par défaut" },
      { en: "Custom", zhCN: "自定义", ja: "カスタム", ru: "Пользовательский", es: "Personalizado", fr: "Personnalisé" },
      { en: "Advanced", zhCN: "高级", ja: "詳細", ru: "Расширенные", es: "Avanzado", fr: "Avancé" },
      { en: "Basic", zhCN: "基础", ja: "基本", ru: "Базовый", es: "Básico", fr: "De base" },
      { en: "Required", zhCN: "必需", ja: "必須", ru: "Обязательно", es: "Requerido", fr: "Requis" },
      { en: "Optional", zhCN: "可选", ja: "任意", ru: "Необязательно", es: "Opcional", fr: "Optionnel" },

      // ── Errors ────────────────────────────────────────────────
      { en: "Error", zhCN: "错误", ja: "エラー", ru: "Ошибка", es: "Error", fr: "Erreur" },
      { en: "Failed", zhCN: "失败", ja: "失敗", ru: "Не удалось", es: "Falló", fr: "Échoué" },
      { en: "Timeout", zhCN: "超时", ja: "タイムアウト", ru: "Таймаут", es: "Tiempo de espera", fr: "Délai d'attente" },
      { en: "Connection refused", zhCN: "连接被拒绝", ja: "接続が拒否されました", ru: "Соединение отклонено", es: "Conexión rechazada", fr: "Connexion refusée" },
      { en: "Connection reset", zhCN: "连接重置", ja: "接続がリセットされました", ru: "Соединение сброшено", es: "Conexión restablecida", fr: "Connexion réinitialisée" },
      { en: "Network error", zhCN: "网络错误", ja: "ネットワークエラー", ru: "Сетевая ошибка", es: "Error de red", fr: "Erreur réseau" },
      { en: "Permission denied", zhCN: "权限被拒绝", ja: "許可が拒否されました", ru: "Доступ запрещён", es: "Permiso denegado", fr: "Permission refusée" },
      { en: "Access denied", zhCN: "访问被拒绝", ja: "アクセスが拒否されました", ru: "Доступ запрещён", es: "Acceso denegado", fr: "Accès refusé" },
      { en: "Not found", zhCN: "未找到", ja: "見つかりません", ru: "Не найдено", es: "No encontrado", fr: "Introuvable" },
      { en: "File not found", zhCN: "文件未找到", ja: "ファイルが見つかりません", ru: "Файл не найден", es: "Archivo no encontrado", fr: "Fichier introuvable" },
      { en: "Invalid input", zhCN: "无效输入", ja: "無効な入力", ru: "Неверный ввод", es: "Entrada inválida", fr: "Entrée invalide" },
      { en: "Invalid argument", zhCN: "无效参数", ja: "無効な引数", ru: "Неверный аргумент", es: "Argumento inválido", fr: "Argument invalide" },
      { en: "Type error", zhCN: "类型错误", ja: "型エラー", ru: "Ошибка типа", es: "Error de tipo", fr: "Erreur de type" },
      { en: "Range error", zhCN: "范围错误", ja: "範囲エラー", ru: "Ошибка диапазона", es: "Error de rango", fr: "Erreur de plage" },
      { en: "Reference error", zhCN: "引用错误", ja: "参照エラー", ru: "Ошибка ссылки", es: "Error de referencia", fr: "Erreur de référence" },
      { en: "Syntax error", zhCN: "语法错误", ja: "構文エラー", ru: "Синтаксическая ошибка", es: "Error de sintaxis", fr: "Erreur de syntaxe", de: "Syntaxfehler" },
      { en: "Out of memory", zhCN: "内存不足", ja: "メモリ不足", ru: "Недостаточно памяти", es: "Sin memoria", fr: "Mémoire insuffisante" },
      { en: "Stack overflow", zhCN: "堆栈溢出", ja: "スタックオーバーフロー", ru: "Переполнение стека", es: "Desbordamiento de pila", fr: "Dépassement de pile" },
      { en: "Null pointer", zhCN: "空指针", ja: "ヌルポインタ", ru: "Нулевой указатель", es: "Puntero nulo", fr: "Pointeur nul" },
      { en: "Division by zero", zhCN: "除以零", ja: "ゼロ除算", ru: "Деление на ноль", es: "División por cero", fr: "Division par zéro" },
      { en: "Unauthorized", zhCN: "未授权", ja: "未認証", ru: "Не авторизован", es: "No autorizado", fr: "Non autorisé" },
      { en: "Forbidden", zhCN: "禁止访问", ja: "禁止", ru: "Запрещено", es: "Prohibido", fr: "Interdit" },
      { en: "Rate limit exceeded", zhCN: "超出速率限制", ja: "レート制限超過", ru: "Превышен лимит запросов", es: "Límite de velocidad excedido", fr: "Limite de débit dépassée" },
      { en: "Quota exceeded", zhCN: "超出配额", ja: "クォータ超過", ru: "Квота исчерпана", es: "Cuota excedida", fr: "Quota dépassé" },
      { en: "Internal error", zhCN: "内部错误", ja: "内部エラー", ru: "Внутренняя ошибка", es: "Error interno", fr: "Erreur interne" },
      { en: "Service unavailable", zhCN: "服务不可用", ja: "サービス利用不可", ru: "Сервис недоступен", es: "Servicio no disponible", fr: "Service indisponible" },
      { en: "Bad gateway", zhCN: "网关错误", ja: "不正ゲートウェイ", ru: "Плохой шлюз", es: "Puerta de enlace incorrecta", fr: "Mauvaise passerelle" },
      { en: "Gateway timeout", zhCN: "网关超时", ja: "ゲートウェイタイムアウト", ru: "Таймаут шлюза", es: "Tiempo de espera de puerta de enlace", fr: "Délai de passerelle dépassé" },
      { en: "Unknown error", zhCN: "未知错误", ja: "不明なエラー", ru: "Неизвестная ошибка", es: "Error desconocido", fr: "Erreur inconnue" },
      { en: "Unexpected token", zhCN: "意外的标记", ja: "予期しないトークン", ru: "Неожиданный токен", es: "Token inesperado", fr: "Jeton inattendu" },
      { en: "Missing parameter", zhCN: "缺少参数", ja: "パラメータ不足", ru: "Отсутствует параметр", es: "Falta parámetro", fr: "Paramètre manquant" },
      { en: "Invalid format", zhCN: "格式无效", ja: "無効な形式", ru: "Неверный формат", es: "Formato inválido", fr: "Format invalide" },

      // ── Tools ─────────────────────────────────────────────────
      { en: "Tool", zhCN: "工具", ja: "ツール", ru: "Инструмент", es: "Herramienta", fr: "Outil" },
      { en: "File", zhCN: "文件", ja: "ファイル", ru: "Файл", es: "Archivo", fr: "Fichier" },
      { en: "Directory", zhCN: "目录", ja: "ディレクトリ", ru: "Каталог", es: "Directorio", fr: "Répertoire" },
      { en: "Read", zhCN: "读取", ja: "読み取り", ru: "Чтение", es: "Leer", fr: "Lire" },
      { en: "Write", zhCN: "写入", ja: "書き込み", ru: "Запись", es: "Escribir", fr: "Écrire" },
      { en: "Execute", zhCN: "执行", ja: "実行", ru: "Выполнить", es: "Ejecutar", fr: "Exécuter" },
      { en: "Run", zhCN: "运行", ja: "実行", ru: "Запустить", es: "Ejecutar", fr: "Exécuter" },
      { en: "Build", zhCN: "构建", ja: "ビルド", ru: "Сборка", es: "Construir", fr: "Compiler" },
      { en: "Test", zhCN: "测试", ja: "テスト", ru: "Тест", es: "Prueba", fr: "Test" },
      { en: "Debug", zhCN: "调试", ja: "デバッグ", ru: "Отладка", es: "Depurar", fr: "Déboguer" },
      { en: "Deploy", zhCN: "部署", ja: "デプロイ", ru: "Развернуть", es: "Desplegar", fr: "Déployer" },
      { en: "Install", zhCN: "安装", ja: "インストール", ru: "Установить", es: "Instalar", fr: "Installer" },
      { en: "Uninstall", zhCN: "卸载", ja: "アンインストール", ru: "Удалить", es: "Desinstalar", fr: "Désinstaller" },
      { en: "Update", zhCN: "更新", ja: "更新", ru: "Обновить", es: "Actualizar", fr: "Mettre à jour" },
      { en: "Upgrade", zhCN: "升级", ja: "アップグレード", ru: "Обновить", es: "Actualizar", fr: "Mettre à niveau" },
      { en: "Patch", zhCN: "补丁", ja: "パッチ", ru: "Патч", es: "Parche", fr: "Correctif" },
      { en: "Commit", zhCN: "提交", ja: "コミット", ru: "Коммит", es: "Confirmar", fr: "Valider" },
      { en: "Push", zhCN: "推送", ja: "プッシュ", ru: "Отправить", es: "Empujar", fr: "Pousser" },
      { en: "Pull", zhCN: "拉取", ja: "プル", ru: "Получить", es: "Jalar", fr: "Tirer" },
      { en: "Merge", zhCN: "合并", ja: "マージ", ru: "Слияние", es: "Fusionar", fr: "Fusionner" },
      { en: "Branch", zhCN: "分支", ja: "ブランチ", ru: "Ветка", es: "Rama", fr: "Branche" },
      { en: "Clone", zhCN: "克隆", ja: "クローン", ru: "Клонировать", es: "Clonar", fr: "Cloner" },
      { en: "Fork", zhCN: "派生", ja: "フォーク", ru: "Форк", es: "Bifurcar", fr: "Fork" },
      { en: "Fetch", zhCN: "获取", ja: "フェッチ", ru: "Получить", es: "Obtener", fr: "Récupérer" },
      { en: "Rebase", zhCN: "变基", ja: "リベース", ru: "Перебазировать", es: "Rebasar", fr: "Rebaser" },
      { en: "Stash", zhCN: "暂存", ja: "スタッシュ", ru: "Спрятать", es: "Guardar", fr: "Remiser" },
      { en: "Diff", zhCN: "差异", ja: "差分", ru: "Разница", es: "Diferencia", fr: "Diff" },
      { en: "Log", zhCN: "日志", ja: "ログ", ru: "Журнал", es: "Registro", fr: "Journal" },
      { en: "Terminal", zhCN: "终端", ja: "端末", ru: "Терминал", es: "Terminal", fr: "Terminal" },
      { en: "Shell", zhCN: "命令行", ja: "シェル", ru: "Оболочка", es: "Shell", fr: "Shell" },
      { en: "Database", zhCN: "数据库", ja: "データベース", ru: "База данных", es: "Base de datos", fr: "Base de données" },
      { en: "Query", zhCN: "查询", ja: "クエリ", ru: "Запрос", es: "Consulta", fr: "Requête" },
      { en: "API", zhCN: "接口", ja: "API", ru: "API", es: "API", fr: "API" },
      { en: "Endpoint", zhCN: "端点", ja: "エンドポイント", ru: "Конечная точка", es: "Extremo", fr: "Point de terminaison" },
      { en: "Request", zhCN: "请求", ja: "リクエスト", ru: "Запрос", es: "Solicitud", fr: "Requête" },
      { en: "Response", zhCN: "响应", ja: "レスポンス", ru: "Ответ", es: "Respuesta", fr: "Réponse" },
      { en: "Header", zhCN: "头部", ja: "ヘッダー", ru: "Заголовок", es: "Encabezado", fr: "En-tête" },
      { en: "Body", zhCN: "正文", ja: "ボディ", ru: "Тело", es: "Cuerpo", fr: "Corps" },
      { en: "Payload", zhCN: "载荷", ja: "ペイロード", ru: "Полезная нагрузка", es: "Carga útil", fr: "Charge utile" },
      { en: "Token", zhCN: "令牌", ja: "トークン", ru: "Токен", es: "Token", fr: "Jeton" },
      { en: "Session", zhCN: "会话", ja: "セッション", ru: "Сессия", es: "Sesión", fr: "Session" },
      { en: "Cache", zhCN: "缓存", ja: "キャッシュ", ru: "Кэш", es: "Caché", fr: "Cache" },
      { en: "Buffer", zhCN: "缓冲区", ja: "バッファ", ru: "Буфер", es: "Búfer", fr: "Tampon" },
      { en: "Stream", zhCN: "流", ja: "ストリーム", ru: "Поток", es: "Flujo", fr: "Flux" },
      { en: "Socket", zhCN: "套接字", ja: "ソケット", ru: "Сокет", es: "Socket", fr: "Socket" },
      { en: "Port", zhCN: "端口", ja: "ポート", ru: "Порт", es: "Puerto", fr: "Port" },
      { en: "Host", zhCN: "主机", ja: "ホスト", ru: "Хост", es: "Anfitrión", fr: "Hôte" },
      { en: "Server", zhCN: "服务器", ja: "サーバー", ru: "Сервер", es: "Servidor", fr: "Serveur" },
      { en: "Client", zhCN: "客户端", ja: "クライアント", ru: "Клиент", es: "Cliente", fr: "Client" },
      { en: "Proxy", zhCN: "代理", ja: "プロキシ", ru: "Прокси", es: "Proxy", fr: "Proxy" },
      { en: "Router", zhCN: "路由器", ja: "ルーター", ru: "Маршрутизатор", es: "Enrutador", fr: "Routeur" },
      { en: "Middleware", zhCN: "中间件", ja: "ミドルウェア", ru: "Промежуточное ПО", es: "Middleware", fr: "Intergiciel" },
      { en: "Plugin", zhCN: "插件", ja: "プラグイン", ru: "Плагин", es: "Complemento", fr: "Extension" },

      // ── Commands ──────────────────────────────────────────────
      { en: "Command", zhCN: "命令", ja: "コマンド", ru: "Команда", es: "Comando", fr: "Commande" },
      { en: "Argument", zhCN: "参数", ja: "引数", ru: "Аргумент", es: "Argumento", fr: "Argument" },
      { en: "Option", zhCN: "选项", ja: "オプション", ru: "Опция", es: "Opción", fr: "Option" },
      { en: "Flag", zhCN: "标志", ja: "フラグ", ru: "Флаг", es: "Bandera", fr: "Drapeau" },
      { en: "Input", zhCN: "输入", ja: "入力", ru: "Ввод", es: "Entrada", fr: "Entrée" },
      { en: "Output", zhCN: "输出", ja: "出力", ru: "Вывод", es: "Salida", fr: "Sortie" },
      { en: "Standard input", zhCN: "标准输入", ja: "標準入力", ru: "Стандартный ввод", es: "Entrada estándar", fr: "Entrée standard" },
      { en: "Standard output", zhCN: "标准输出", ja: "標準出力", ru: "Стандартный вывод", es: "Salida estándar", fr: "Sortie standard" },
      { en: "Standard error", zhCN: "标准错误", ja: "標準エラー", ru: "Стандартная ошибка", es: "Error estándar", fr: "Erreur standard" },
      { en: "Exit code", zhCN: "退出码", ja: "終了コード", ru: "Код выхода", es: "Código de salida", fr: "Code de sortie" },
      { en: "Return value", zhCN: "返回值", ja: "戻り値", ru: "Возвращаемое значение", es: "Valor de retorno", fr: "Valeur de retour" },
      { en: "Subcommand", zhCN: "子命令", ja: "サブコマンド", ru: "Подкоманда", es: "Subcomando", fr: "Sous-commande" },
      { en: "Alias", zhCN: "别名", ja: "エイリアス", ru: "Псевдоним", es: "Alias", fr: "Alias" },
      { en: "Shortcut", zhCN: "快捷键", ja: "ショートカット", ru: "Ярлык", es: "Atajo", fr: "Raccourci" },
      { en: "Hotkey", zhCN: "热键", ja: "ホットキー", ru: "Горячая клавиша", es: "Tecla rápida", fr: "Touche de raccourci" },
      { en: "Binding", zhCN: "绑定", ja: "バインド", ru: "Привязка", es: "Enlace", fr: "Liaison" },

      // ── General Programming ───────────────────────────────────
      { en: "Function", zhCN: "函数", ja: "関数", ru: "Функция", es: "Función", fr: "Fonction" },
      { en: "Method", zhCN: "方法", ja: "メソッド", ru: "Метод", es: "Método", fr: "Méthode" },
      { en: "Class", zhCN: "类", ja: "クラス", ru: "Класс", es: "Clase", fr: "Classe" },
      { en: "Object", zhCN: "对象", ja: "オブジェクト", ru: "Объект", es: "Objeto", fr: "Objet" },
      { en: "Instance", zhCN: "实例", ja: "インスタンス", ru: "Экземпляр", es: "Instancia", fr: "Instance" },
      { en: "Interface", zhCN: "接口", ja: "インターフェース", ru: "Интерфейс", es: "Interfaz", fr: "Interface" },
      { en: "Abstract", zhCN: "抽象", ja: "抽象", ru: "Абстрактный", es: "Abstracto", fr: "Abstrait" },
      { en: "Implementation", zhCN: "实现", ja: "実装", ru: "Реализация", es: "Implementación", fr: "Implémentation" },
      { en: "Inheritance", zhCN: "继承", ja: "継承", ru: "Наследование", es: "Herencia", fr: "Héritage" },
      { en: "Polymorphism", zhCN: "多态", ja: "ポリモーフィズム", ru: "Полиморфизм", es: "Polimorfismo", fr: "Polymorphisme" },
      { en: "Encapsulation", zhCN: "封装", ja: "カプセル化", ru: "Инкапсуляция", es: "Encapsulación", fr: "Encapsulation" },
      { en: "Module", zhCN: "模块", ja: "モジュール", ru: "Модуль", es: "Módulo", fr: "Module" },
      { en: "Package", zhCN: "包", ja: "パッケージ", ru: "Пакет", es: "Paquete", fr: "Paquet" },
      { en: "Library", zhCN: "库", ja: "ライブラリ", ru: "Библиотека", es: "Biblioteca", fr: "Bibliothèque" },
      { en: "Framework", zhCN: "框架", ja: "フレームワーク", ru: "Фреймворк", es: "Marco", fr: "Cadre" },
      { en: "Dependency", zhCN: "依赖", ja: "依存関係", ru: "Зависимость", es: "Dependencia", fr: "Dépendance" },
      { en: "Variable", zhCN: "变量", ja: "変数", ru: "Переменная", es: "Variable", fr: "Variable" },
      { en: "Constant", zhCN: "常量", ja: "定数", ru: "Константа", es: "Constante", fr: "Constante" },
      { en: "Parameter", zhCN: "参数", ja: "パラメータ", ru: "Параметр", es: "Parámetro", fr: "Paramètre" },
      { en: "Property", zhCN: "属性", ja: "プロパティ", ru: "Свойство", es: "Propiedad", fr: "Propriété" },
      { en: "Attribute", zhCN: "特性", ja: "属性", ru: "Атрибут", es: "Atributo", fr: "Attribut" },
      { en: "Array", zhCN: "数组", ja: "配列", ru: "Массив", es: "Arreglo", fr: "Tableau" },
      { en: "List", zhCN: "列表", ja: "リスト", ru: "Список", es: "Lista", fr: "Liste" },
      { en: "Map", zhCN: "映射", ja: "マップ", ru: "Словарь", es: "Mapa", fr: "Tableau associatif" },
      { en: "Set", zhCN: "集合", ja: "セット", ru: "Множество", es: "Conjunto", fr: "Ensemble" },
      { en: "Queue", zhCN: "队列", ja: "キュー", ru: "Очередь", es: "Cola", fr: "File" },
      { en: "Stack", zhCN: "堆栈", ja: "スタック", ru: "Стек", es: "Pila", fr: "Pile" },
      { en: "Tree", zhCN: "树", ja: "ツリー", ru: "Дерево", es: "Árbol", fr: "Arbre" },
      { en: "Graph", zhCN: "图", ja: "グラフ", ru: "Граф", es: "Grafo", fr: "Graphe" },
      { en: "Node", zhCN: "节点", ja: "ノード", ru: "Узел", es: "Nodo", fr: "Nœud" },
      { en: "Edge", zhCN: "边", ja: "エッジ", ru: "Ребро", es: "Arista", fr: "Arête" },
      { en: "Loop", zhCN: "循环", ja: "ループ", ru: "Цикл", es: "Bucle", fr: "Boucle" },
      { en: "Iteration", zhCN: "迭代", ja: "反復", ru: "Итерация", es: "Iteración", fr: "Itération" },
      { en: "Recursion", zhCN: "递归", ja: "再帰", ru: "Рекурсия", es: "Recursión", fr: "Récursivité" },
      { en: "Callback", zhCN: "回调", ja: "コールバック", ru: "Обратный вызов", es: "Retrollamada", fr: "Rappel" },
      { en: "Promise", zhCN: "承诺", ja: "プロミス", ru: "Промис", es: "Promesa", fr: "Promesse" },
      { en: "Async", zhCN: "异步", ja: "非同期", ru: "Асинхронный", es: "Asíncrono", fr: "Asynchrone" },
      { en: "Await", zhCN: "等待", ja: "待機", ru: "Ожидание", es: "Esperar", fr: "Attendre" },
      { en: "Event", zhCN: "事件", ja: "イベント", ru: "Событие", es: "Evento", fr: "Événement" },
      { en: "Listener", zhCN: "监听器", ja: "リスナー", ru: "Слушатель", es: "Oyente", fr: "Écouteur" },
      { en: "Emitter", zhCN: "发射器", ja: "エミッター", ru: "Излучатель", es: "Emisor", fr: "Émetteur" },
      { en: "Observer", zhCN: "观察者", ja: "オブザーバー", ru: "Наблюдатель", es: "Observador", fr: "Observateur" },
      { en: "Generator", zhCN: "生成器", ja: "ジェネレータ", ru: "Генератор", es: "Generador", fr: "Générateur" },
      { en: "Iterator", zhCN: "迭代器", ja: "イテレータ", ru: "Итератор", es: "Iterador", fr: "Itérateur" },
      { en: "Decorator", zhCN: "装饰器", ja: "デコレータ", ru: "Декоратор", es: "Decorador", fr: "Décorateur" },
      { en: "Annotation", zhCN: "注解", ja: "アノテーション", ru: "Аннотация", es: "Anotación", fr: "Annotation" },
      { en: "Reflection", zhCN: "反射", ja: "リフレクション", ru: "Рефлексия", es: "Reflexión", fr: "Réflexion" },
      { en: "Serialization", zhCN: "序列化", ja: "シリアル化", ru: "Сериализация", es: "Serialización", fr: "Sérialisation" },
      { en: "Deserialization", zhCN: "反序列化", ja: "逆シリアル化", ru: "Десериализация", es: "Deserialización", fr: "Désérialisation" },
      { en: "Parsing", zhCN: "解析", ja: "解析", ru: "Парсинг", es: "Análisis", fr: "Analyse" },
      { en: "Compilation", zhCN: "编译", ja: "コンパイル", ru: "Компиляция", es: "Compilación", fr: "Compilation" },
      { en: "Interpretation", zhCN: "解释", ja: "インタプリタ", ru: "Интерпретация", es: "Interpretación", fr: "Interprétation" },
      { en: "Optimization", zhCN: "优化", ja: "最適化", ru: "Оптимизация", es: "Optimización", fr: "Optimisation" },
      { en: "Allocation", zhCN: "分配", ja: "割り当て", ru: "Выделение", es: "Asignación", fr: "Allocation" },
      { en: "Garbage collection", zhCN: "垃圾回收", ja: "ガベージコレクション", ru: "Сборка мусора", es: "Recolección de basura", fr: "Collecte des déchets" },
      { en: "Memory leak", zhCN: "内存泄漏", ja: "メモリリーク", ru: "Утечка памяти", es: "Fuga de memoria", fr: "Fuite de mémoire" },
      { en: "Race condition", zhCN: "竞态条件", ja: "競合状態", ru: "Состояние гонки", es: "Condición de carrera", fr: "Condition de concurrence" },
      { en: "Deadlock", zhCN: "死锁", ja: "デッドロック", ru: "Взаимная блокировка", es: "Punto muerto", fr: "Interblocage" },
      { en: "Thread", zhCN: "线程", ja: "スレッド", ru: "Поток", es: "Hilo", fr: "Fil d'exécution" },
      { en: "Process", zhCN: "进程", ja: "プロセス", ru: "Процесс", es: "Proceso", fr: "Processus" },
      { en: "Mutex", zhCN: "互斥锁", ja: "ミューテックス", ru: "Мьютекс", es: "Mutex", fr: "Mutex" },
      { en: "Semaphore", zhCN: "信号量", ja: "セマフォ", ru: "Семафор", es: "Semáforo", fr: "Sémaphore" },
      { en: "Algorithm", zhCN: "算法", ja: "アルゴリズム", ru: "Алгоритм", es: "Algoritmo", fr: "Algorithme" },
      { en: "Data structure", zhCN: "数据结构", ja: "データ構造", ru: "Структура данных", es: "Estructura de datos", fr: "Structure de données" },
      { en: "Design pattern", zhCN: "设计模式", ja: "デザインパターン", ru: "Шаблон проектирования", es: "Patrón de diseño", fr: "Patron de conception" },
      { en: "Singleton", zhCN: "单例", ja: "シングルトン", ru: "Одиночка", es: "Singleton", fr: "Singleton" },
      { en: "Factory", zhCN: "工厂", ja: "ファクトリ", ru: "Фабрика", es: "Fábrica", fr: "Fabrique" },
      { en: "Builder", zhCN: "生成器", ja: "ビルダー", ru: "Строитель", es: "Constructor", fr: "Constructeur" },
      { en: "Adapter", zhCN: "适配器", ja: "アダプター", ru: "Адаптер", es: "Adaptador", fr: "Adaptateur" },
      { en: "Proxy", zhCN: "代理", ja: "プロキシ", ru: "Заместитель", es: "Proxy", fr: "Proxy" },
      { en: "Namespace", zhCN: "命名空间", ja: "名前空間", ru: "Пространство имён", es: "Espacio de nombres", fr: "Espace de noms" },
      { en: "Scope", zhCN: "作用域", ja: "スコープ", ru: "Область видимости", es: "Ámbito", fr: "Portée" },
      { en: "Closure", zhCN: "闭包", ja: "クロージャ", ru: "Замыкание", es: "Cierre", fr: "Fermeture" },
      { en: "Context", zhCN: "上下文", ja: "コンテキスト", ru: "Контекст", es: "Contexto", fr: "Contexte" },
      { en: "State", zhCN: "状态", ja: "状態", ru: "Состояние", es: "Estado", fr: "État" },
      { en: "Immutable", zhCN: "不可变", ja: "不変", ru: "Неизменяемый", es: "Inmutable", fr: "Immuable" },
      { en: "Mutable", zhCN: "可变的", ja: "可変", ru: "Изменяемый", es: "Mutable", fr: "Mutable" },
      { en: "Static", zhCN: "静态", ja: "静的", ru: "Статический", es: "Estático", fr: "Statique" },
      { en: "Dynamic", zhCN: "动态", ja: "動的", ru: "Динамический", es: "Dinámico", fr: "Dynamique" },
      { en: "Public", zhCN: "公开", ja: "公開", ru: "Открытый", es: "Público", fr: "Public" },
      { en: "Private", zhCN: "私有", ja: "プライベート", ru: "Закрытый", es: "Privado", fr: "Privé" },
      { en: "Protected", zhCN: "受保护", ja: "保護", ru: "Защищённый", es: "Protegido", fr: "Protégé" },
      { en: "Override", zhCN: "重写", ja: "オーバーライド", ru: "Переопределить", es: "Sobrescribir", fr: "Surcharger" },
      { en: "Overload", zhCN: "重载", ja: "オーバーロード", ru: "Перегрузить", es: "Sobrecargar", fr: "Surcharger" },
      { en: "Exception", zhCN: "异常", ja: "例外", ru: "Исключение", es: "Excepción", fr: "Exception" },
      { en: "Throw", zhCN: "抛出", ja: "スロー", ru: "Бросить", es: "Lanzar", fr: "Lancer" },
      { en: "Catch", zhCN: "捕获", ja: "キャッチ", ru: "Поймать", es: "Atrapar", fr: "Attraper" },
      { en: "Finally", zhCN: "最终", ja: "ファイナリ", ru: "Наконец", es: "Finalmente", fr: "Enfin" },
      { en: "Try", zhCN: "尝试", ja: "試行", ru: "Попробовать", es: "Intentar", fr: "Essayer" },
      { en: "Assertion", zhCN: "断言", ja: "アサーション", ru: "Утверждение", es: "Afirmación", fr: "Assertion" },
      { en: "Validation", zhCN: "验证", ja: "検証", ru: "Валидация", es: "Validación", fr: "Validation" },
      { en: "Sanitization", zhCN: "清理", ja: "サニタイズ", ru: "Санитизация", es: "Saneamiento", fr: "Assainissement" },
      { en: "Encoding", zhCN: "编码", ja: "エンコーディング", ru: "Кодирование", es: "Codificación", fr: "Encodage" },
      { en: "Decoding", zhCN: "解码", ja: "デコーディング", ru: "Декодирование", es: "Decodificación", fr: "Décodage" },
      { en: "Encryption", zhCN: "加密", ja: "暗号化", ru: "Шифрование", es: "Cifrado", fr: "Chiffrement" },
      { en: "Decryption", zhCN: "解密", ja: "復号化", ru: "Дешифрование", es: "Descifrado", fr: "Déchiffrement" },
      { en: "Hash", zhCN: "哈希", ja: "ハッシュ", ru: "Хэш", es: "Hash", fr: "Hachage" },
      { en: "Checksum", zhCN: "校验和", ja: "チェックサム", ru: "Контрольная сумма", es: "Suma de verificación", fr: "Somme de contrôle" },
      { en: "Backup", zhCN: "备份", ja: "バックアップ", ru: "Резервная копия", es: "Copia de seguridad", fr: "Sauvegarde" },
      { en: "Restore", zhCN: "恢复", ja: "復元", ru: "Восстановить", es: "Restaurar", fr: "Restaurer" },
      { en: "Rollback", zhCN: "回滚", ja: "ロールバック", ru: "Откат", es: "Reversión", fr: "Retour en arrière" },
      { en: "Migration", zhCN: "迁移", ja: "移行", ru: "Миграция", es: "Migración", fr: "Migration" },
      { en: "Schema", zhCN: "模式", ja: "スキーマ", ru: "Схема", es: "Esquema", fr: "Schéma" },
      { en: "Template", zhCN: "模板", ja: "テンプレート", ru: "Шаблон", es: "Plantilla", fr: "Modèle" },
      { en: "Placeholder", zhCN: "占位符", ja: "プレースホルダ", ru: "Заполнитель", es: "Marcador de posición", fr: "Espace réservé" },
      { en: "Regex", zhCN: "正则表达式", ja: "正規表現", ru: "Регулярное выражение", es: "Expresión regular", fr: "Expression régulière" },
      { en: "Whitespace", zhCN: "空白字符", ja: "空白文字", ru: "Пробел", es: "Espacio en blanco", fr: "Espace blanc" },
      { en: "Delimiter", zhCN: "分隔符", ja: "区切り文字", ru: "Разделитель", es: "Delimitador", fr: "Délimiteur" },
      { en: "Indentation", zhCN: "缩进", ja: "インデント", ru: "Отступ", es: "Sangría", fr: "Indentation" },
      { en: "Comment", zhCN: "注释", ja: "コメント", ru: "Комментарий", es: "Comentario", fr: "Commentaire" },
      { en: "Documentation", zhCN: "文档", ja: "ドキュメント", ru: "Документация", es: "Documentación", fr: "Documentation" },
      { en: "Unit test", zhCN: "单元测试", ja: "単体テスト", ru: "Модульный тест", es: "Prueba unitaria", fr: "Test unitaire" },
      { en: "Integration test", zhCN: "集成测试", ja: "結合テスト", ru: "Интеграционный тест", es: "Prueba de integración", fr: "Test d'intégration" },
      { en: "End to end", zhCN: "端到端", ja: "エンドツーエンド", ru: "Сквозной", es: "De extremo a extremo", fr: "De bout en bout" },
      { en: "Coverage", zhCN: "覆盖率", ja: "カバレッジ", ru: "Покрытие", es: "Cobertura", fr: "Couverture" },
      { en: "Mock", zhCN: "模拟", ja: "モック", ru: "Мок", es: "Simulacro", fr: "Simulacre" },
      { en: "Stub", zhCN: "桩", ja: "スタブ", ru: "Заглушка", es: "Stub", fr: "Bouchon" },
      { en: "Fixture", zhCN: "夹具", ja: "フィクスチャ", ru: "Фикстура", es: "Accesorio", fr: "Fixation" },
      { en: "Benchmark", zhCN: "基准测试", ja: "ベンチマーク", ru: "Бенчмарк", es: "Punto de referencia", fr: "Référence" },
      { en: "Profiling", zhCN: "性能分析", ja: "プロファイリング", ru: "Профилирование", es: "Perfilado", fr: "Profilage" },
      { en: "Latency", zhCN: "延迟", ja: "レイテンシ", ru: "Задержка", es: "Latencia", fr: "Latence" },
      { en: "Throughput", zhCN: "吞吐量", ja: "スループット", ru: "Пропускная способность", es: "Rendimiento", fr: "Débit" },
      { en: "Bandwidth", zhCN: "带宽", ja: "帯域幅", ru: "Пропускная способность", es: "Ancho de banda", fr: "Bande passante" },
      { en: "Scalability", zhCN: "可伸缩性", ja: "スケーラビリティ", ru: "Масштабируемость", es: "Escalabilidad", fr: "Évolutivité" },
      { en: "Availability", zhCN: "可用性", ja: "可用性", ru: "Доступность", es: "Disponibilidad", fr: "Disponibilité" },
      { en: "Reliability", zhCN: "可靠性", ja: "信頼性", ru: "Надёжность", es: "Fiabilidad", fr: "Fiabilité" },
      { en: "Redundancy", zhCN: "冗余", ja: "冗長性", ru: "Избыточность", es: "Redundancia", fr: "Redondance" },
      { en: "Failover", zhCN: "故障转移", ja: "フェイルオーバー", ru: "Аварийное переключение", es: "Conmutación por error", fr: "Basculement" },
      { en: "Load balancing", zhCN: "负载均衡", ja: "負荷分散", ru: "Балансировка нагрузки", es: "Balanceo de carga", fr: "Équilibrage de charge" },
      { en: "Throttling", zhCN: "节流", ja: "スロットリング", ru: "Дросселирование", es: "Limitación", fr: "Étranglement" },
      { en: "Idempotent", zhCN: "幂等", ja: "冪等", ru: "Идемпотентный", es: "Idempotente", fr: "Idempotent" },
      { en: "Atomic", zhCN: "原子", ja: "アトミック", ru: "Атомарный", es: "Atómico", fr: "Atomique" },
      { en: "Transactional", zhCN: "事务性", ja: "トランザクション", ru: "Транзакционный", es: "Transaccional", fr: "Transactionnel" },
      { en: "ACID", zhCN: "ACID", ja: "ACID", ru: "ACID", es: "ACID", fr: "ACID" },
      { en: "Consistency", zhCN: "一致性", ja: "一貫性", ru: "Согласованность", es: "Consistencia", fr: "Cohérence" },
      { en: "Partition", zhCN: "分区", ja: "パーティション", ru: "Раздел", es: "Partición", fr: "Partition" },
      { en: "Shard", zhCN: "分片", ja: "シャード", ru: "Шард", es: "Fragmento", fr: "Fragment" },
      { en: "Replication", zhCN: "复制", ja: "レプリケーション", ru: "Репликация", es: "Replicación", fr: "Réplication" },
      { en: "Container", zhCN: "容器", ja: "コンテナ", ru: "Контейнер", es: "Contenedor", fr: "Conteneur" },
      { en: "Virtualization", zhCN: "虚拟化", ja: "仮想化", ru: "Виртуализация", es: "Virtualización", fr: "Virtualisation" },
      { en: "Orchestration", zhCN: "编排", ja: "オーケストレーション", ru: "Оркестрация", es: "Orquestación", fr: "Orchestration" },
      { en: "Pipeline", zhCN: "流水线", ja: "パイプライン", ru: "Конвейер", es: "Canalización", fr: "Pipeline" },
      { en: "Workflow", zhCN: "工作流", ja: "ワークフロー", ru: "Рабочий процесс", es: "Flujo de trabajo", fr: "Flux de travail" },
      { en: "Artifact", zhCN: "产物", ja: "アーティファクト", ru: "Артефакт", es: "Artefacto", fr: "Artefact" },
      { en: "Registry", zhCN: "注册表", ja: "レジストリ", ru: "Реестр", es: "Registro", fr: "Registre" },
      { en: "Repository", zhCN: "仓库", ja: "リポジトリ", ru: "Репозиторий", es: "Repositorio", fr: "Dépôt" },
      { en: "Version control", zhCN: "版本控制", ja: "バージョン管理", ru: "Контроль версий", es: "Control de versiones", fr: "Contrôle de version" },
      { en: "Continuous integration", zhCN: "持续集成", ja: "継続的インテグレーション", ru: "Непрерывная интеграция", es: "Integración continua", fr: "Intégration continue" },
      { en: "Continuous deployment", zhCN: "持续部署", ja: "継続的デプロイ", ru: "Непрерывное развёртывание", es: "Despliegue continuo", fr: "Déploiement continu" },
    ];

    for (const entry of defaults) {
      if (entry.zhCN) this.addTerm(entry.en, entry.zhCN, "zh-CN");
      if (entry.ja) this.addTerm(entry.en, entry.ja, "ja");
      if (entry.ru) this.addTerm(entry.en, entry.ru, "ru");
      if (entry.es) this.addTerm(entry.en, entry.es, "es");
      if (entry.fr) this.addTerm(entry.en, entry.fr, "fr");
      if (entry.de) this.addTerm(entry.en, entry.de, "de");
    }
  }

  // ---------------------------------------------------------------
  //  Public API
  // ---------------------------------------------------------------

  /**
   * Add a translation for a term in a specific language.
   * @param {string} source - source term (English)
   * @param {string} target - translated term
   * @param {string} lang - target language code
   * @returns {this}
   */
  addTerm(source, target, lang) {
    if (typeof source !== "string" || source.length === 0) {
      throw new TypeError("source must be a non-empty string");
    }
    if (typeof target !== "string" || target.length === 0) {
      throw new TypeError("target must be a non-empty string");
    }
    if (typeof lang !== "string" || lang.length === 0) {
      throw new TypeError("lang must be a non-empty string");
    }

    this[_langs].add(lang);

    if (!this[_terms].has(source)) {
      this[_terms].set(source, new Map());
    }
    this[_terms].get(source).set(lang, target);
    return this;
  }

  /**
   * Look up the translation of a term in a given language.
   * Returns null if no translation exists.
   * @param {string} term - the source term to look up
   * @param {string} lang - target language code
   * @returns {string|null}
   */
  lookup(term, lang) {
    const langMap = this[_terms].get(term);
    if (!langMap) return null;
    return langMap.get(lang) || null;
  }

  /**
   * Import glossary entries from a JSON file.
   * Expected format:
   *   [
   *     { "source": "...", "target": "...", "lang": "..." },
   *     ...
   *   ]
   * @param {string} filePath - path to JSON file
   * @returns {number} count of imported entries
   */
  importGlossary(filePath) {
    const resolved = path.resolve(filePath);
    const raw = fs.readFileSync(resolved, "utf8");
    const entries = JSON.parse(raw);

    if (!Array.isArray(entries)) {
      throw new TypeError("Glossary file must contain a JSON array");
    }

    let count = 0;
    for (const entry of entries) {
      if (!entry.source || !entry.target || !entry.lang) continue;
      this.addTerm(entry.source, entry.target, entry.lang);
      count++;
    }
    return count;
  }

  /**
   * Export all glossary entries to a JSON file.
   * @param {string} filePath - destination file path
   * @returns {number} count of exported entries
   */
  exportGlossary(filePath) {
    const resolved = path.resolve(filePath);
    const entries = [];

    for (const [source, langMap] of this[_terms]) {
      for (const [lang, target] of langMap) {
        entries.push({ source, target, lang });
      }
    }

    fs.writeFileSync(resolved, JSON.stringify(entries, null, 2), "utf8");
    return entries.length;
  }

  /**
   * Get the list of languages that have at least one translation.
   * @returns {string[]}
   */
  getLanguages() {
    return Array.from(this[_langs]).sort();
  }

  /**
   * Get the total number of unique source terms in the glossary.
   * @returns {number}
   */
  getTermCount() {
    return this[_terms].size;
  }

  /**
   * Get all translations for a given source term.
   * Returns a Map of lang -> translation, or null if term not found.
   * @param {string} term
   * @returns {Map<string, string>|null}
   */
  getTranslations(term) {
    const langMap = this[_terms].get(term);
    return langMap ? new Map(langMap) : null;
  }

  /**
   * Remove a term and all its translations.
   * @param {string} term
   * @returns {boolean}
   */
  removeTerm(term) {
    return this[_terms].delete(term);
  }

  /**
   * Clear all terms.
   */
  clear() {
    this[_terms].clear();
  }
}

module.exports = { TranslationGlossary };
