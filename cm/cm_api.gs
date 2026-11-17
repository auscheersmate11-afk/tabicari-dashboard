/**
 * Cheers mate DM（個人ページ）の受け口　2026-11-17
 *
 * 画面：https://auscheersmate11-afk.github.io/tabicari-dashboard/cm/#k=<合言葉>（旅キャリGo と同じ作り・同じ色）
 *
 * 今の「抹茶の配布」の仕組みはそのまま使う。このスクリプトは、本人の専用スプシ（◯◯さん専用_抹茶スプレッドシート一覧）の
 * 「見込み顧客リスト」を読んで画面に出し、ボタンが押されたら同じシートの「ステータス」を書きかえるだけ。
 *   ・送信済み      → ステータス＝送信完了・送った方法（画面で選んだもの）
 *   ・あえて送らない → ステータス＝あえて送らない・送らない理由（その他のときはメモにも一言）
 * Customer List への記入・翌朝の回収・ほかの人への回し直しは、これまでどおり毎時の配布の仕組みがやる（ここでは触らない）。
 *
 * 置き場所：新しい Apps Script プロジェクト（script.google.com → 新しいプロジェクト「Cheers mate DM」）にこのファイルだけ貼る。
 * 使う表：
 *   (元データ)抹茶アプローチ先リスト・成約分析（MASTER_ID）… 「配布先」A受講生・D抹茶スプレッドシート一覧URL、「配布台帳」（自分の数字）
 *   Customer List（LIST_ID）「全体共有リスト」… さがす（重複チェック）と返信の数（読むだけ）
 *
 * 画面から POST（本文は JSON・Content-Type text/plain）
 *   {action:"me",    key}                       … 名前・未送信のカード・自分の数字
 *   {action:"sent",  key, id, method}           … id＝配布ID
 *   {action:"skip",  key, id, reason, note}
 *   {action:"check", key, q}                    … Instagram のユーザー名 or URL で Customer List を見る（読むだけ）
 *
 * 本人確認は合言葉：スクリプトプロパティ CM_KEYS = {"合言葉": "受講生の名前"}（cmIssueKeys で作る。名前ごとの個人ページURLは cmIssueKeys のログと「個人ページURL」タブに出る）
 */

var CM = {
  MASTER_ID: '1ZbuIyv3--0ofzEbZW6XmGbyxDSlfK8r_uVKe326yviA',
  LIST_ID: '1qSUsQ1wg3eqveWJH85v6I0xTk49-Qa6fZi6uvfSpmps',
  LIST_TAB: '全体共有リスト',
  DEST_TAB: '配布先',
  LEDGER_TAB: '配布台帳',
  MY_TAB: '見込み顧客リスト',
  URL_TAB: '個人ページURL',      // cmIssueKeys が (元データ) に作る：名前・個人ページURL
  GOAL: 500,                      // 月の目標（画面の「今月」）
  APP_BASE: 'https://auscheersmate11-afk.github.io/tabicari-dashboard/cm/#k=',
  TZ: 'Asia/Tokyo',
  CACHE_MIN: 25                   // 数字（台帳・Customer List）を覚えておく分数（cmWarm が10分ごとに作り直す）
};

function doGet() { return cmOut_({ ok: false, error: 'post' }); }

function doPost(e) {
  var req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return cmOut_({ ok: false, error: 'json' }); }
  var name = cmWho_(req.key);
  if (!name) { Utilities.sleep(800); return cmOut_({ ok: false, error: 'key' }); }   // 合言葉の総当たりを遅くする
  try {
    if (req.action === 'check') return cmOut_(cmCheck_(name, req));
    var P = cmPerson_(name);
    if (!P) return cmOut_({ ok: false, error: 'who' });
    if (req.action === 'me') return cmOut_(cmMe_(P));
    if (req.action === 'sent') return cmOut_(cmSet_(P, req, 'sent'));
    if (req.action === 'skip') return cmOut_(cmSet_(P, req, 'skip'));
    return cmOut_({ ok: false, error: 'action' });
  } catch (err) {
    console.error(err);
    return cmOut_({ ok: false, error: 'server' });
  }
}

function cmOut_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function cmKeys_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('CM_KEYS') || '{}'); } catch (e) { return {}; } }
function cmWho_(key) { key = String(key || ''); if (key.length < 16) return ''; return cmKeys_()[key] || ''; }
function cmNorm_(s) { return String(s || '').replace(/[\s　]/g, '').replace(/髙/g, '高'); }
function cmToday_() { return Utilities.formatDate(new Date(), CM.TZ, 'yyyy/MM/dd'); }
function cmDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CM.TZ, 'yyyy/MM/dd');
  var m = String(v || '').match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  return m ? m[1] + '/' + ('0' + m[2]).slice(-2) + '/' + ('0' + m[3]).slice(-2) : '';
}
function cmAddDays_(ymd, n) { var p = ymd.split('/'); return Utilities.formatDate(new Date(+p[0], +p[1] - 1, +p[2] + n, 12), CM.TZ, 'yyyy/MM/dd'); }
function cmDiff_(a, b) { var f = function (s) { var p = s.split('/'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }; return Math.round((f(a) - f(b)) / 864e5); }
function cmSheetId_(url) { var m = String(url || '').match(/\/d\/([A-Za-z0-9_-]{20,})/); return m ? m[1] : ''; }

// Instagram のユーザー名（URL・@付き・?igsh= 付きでも）
function cmUser_(q) {
  var s = String(q || '').trim(), m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (m) s = m[1]; else if (/^@/.test(s) || /^[A-Za-z0-9._]+$/.test(s)) s = s.replace(/^@/, ''); else return '';
  s = s.toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(s) || /^(p|reel|reels|explore|stories|accounts)$/.test(s)) return '';
  return s;
}

// 配布先の行（名前 → 専用スプシ）
function cmPerson_(name) {
  var v = SpreadsheetApp.openById(CM.MASTER_ID).getSheetByName(CM.DEST_TAB).getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (cmNorm_(v[i][0]) !== cmNorm_(name)) continue;
    var id = cmSheetId_(v[i][3]);
    if (!id) return null;
    return { name: String(v[i][0]).trim(), perDay: Number(v[i][2]) || 0, sheetId: id, en: String(v[i][8] || '') };
  }
  return null;
}

// 見込み顧客リスト（2行目が見出し・3行目から）。見出しの名前で列を探す
function cmMy_(P) {
  var sh = SpreadsheetApp.openById(P.sheetId).getSheetByName(CM.MY_TAB);
  var last = sh.getLastRow(), lastC = sh.getLastColumn();
  var head = sh.getRange(2, 1, 1, lastC).getValues()[0].map(String);
  var col = function (re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  var C = { date: col(/^配布日/), due: col(/^送信期限/), st: col(/^ステータス/), how: col(/^送った方法/), shop: col(/^会社名/), country: col(/^国$/), kind: col(/^種類/),
            url: col(/^URL/), ig: col(/^Instagram/), mail: col(/^メール/), text: col(/^1通目の文章/), tno: col(/^文章の番号/), cl: col(/^Customer List/), memo: col(/^メモ/),
            id: col(/^配布ID/), phone: col(/^電話/), why: col(/^送らない理由/) };
  var v = last >= 3 ? sh.getRange(3, 1, last - 2, lastC).getValues() : [];
  var reasons = [];
  try { var dv = C.why >= 0 ? sh.getRange(3, C.why + 1).getDataValidation() : null; if (dv) reasons = dv.getCriteriaValues()[0].map(String); } catch (e) {}
  return { sh: sh, C: C, v: v, reasons: reasons };
}

function cmMe_(P) {
  var M = cmMy_(P), C = M.C, today = cmToday_();
  var cards = [];
  M.v.forEach(function (r) {
    if (String(r[C.st]).trim() !== '未送信' || !r[C.id]) return;
    var due = cmDate_(r[C.due]);
    var ig = cmUser_(r[C.ig]) || cmUser_(r[C.url]);
    cards.push({ id: String(r[C.id]), disp: String(r[C.shop] || ''), user: ig, method: String(r[C.how] || 'Instagram'),
      country: String(r[C.country] || ''), kind: String(r[C.kind] || ''), site: /^https?:/.test(String(r[C.url])) && !/instagram\.com/i.test(String(r[C.url])) ? String(r[C.url]) : '',
      mail: String(r[C.mail] || '').trim(), phone: C.phone >= 0 ? String(r[C.phone] || '') : '', text: String(r[C.text] || ''), tno: String(r[C.tno] || ''),
      left: due ? cmDiff_(due, today) : 0 });
  });
  cards.sort(function (a, b) { return a.left - b.left; });
  var st = cmStats_(P.name);
  var doneToday = M.v.filter(function (r) { return String(r[C.st]).trim() === '送信完了' && cmDate_(r[C.date]) <= today && String(r[C.cl] || '') === ''; }).length;
  // 今日の数：台帳の「送信完了日＝今日」＋まだ台帳に入っていない送信完了（毎時の記入待ち）
  st.today = Math.max(st.today, st.todayLedger + doneToday);
  return { ok: true, name: P.name, en: P.en, today: today, perDay: P.perDay, goal: CM.GOAL, stats: st, cards: cards,
    reasons: M.reasons.length ? M.reasons : ['抹茶・カフェと関係ない', 'お店がない・閉店', '連絡先が見つからない', 'インスタしかない', '前に自分で送った', '送れない国', 'その他（メモに書く）'],
    sheet: 'https://docs.google.com/spreadsheets/d/' + P.sheetId + '/edit' };
}

function cmSet_(P, req, kind) {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var M = cmMy_(P), C = M.C, id = String(req.id || '');
    for (var i = 0; i < M.v.length; i++) {
      if (String(M.v[i][C.id]) !== id) continue;
      var row = i + 3, now = String(M.v[i][C.st]).trim();
      if (now !== '未送信') return { ok: false, error: 'state' };
      if (kind === 'sent') {
        var how = ['Instagram', 'メール', 'お問合せフォーム'].indexOf(req.method) >= 0 ? req.method : '';
        if (how && C.how >= 0) M.sh.getRange(row, C.how + 1).setValue(how);
        M.sh.getRange(row, C.st + 1).setValue('送信完了');
      } else {
        var why = String(req.reason || '').slice(0, 60);
        if (M.reasons.length && M.reasons.indexOf(why) < 0) why = M.reasons[M.reasons.length - 1];
        if (C.why >= 0 && why) M.sh.getRange(row, C.why + 1).setValue(why);
        var note = String(req.note || '').slice(0, 80);
        if (note && C.memo >= 0) M.sh.getRange(row, C.memo + 1).setValue((String(M.v[i][C.memo] || '') ? M.v[i][C.memo] + ' / ' : '') + note);
        M.sh.getRange(row, C.st + 1).setValue('あえて送らない');
      }
      SpreadsheetApp.flush();
      return { ok: true, kind: 'ok', row: row };
    }
    return { ok: false, error: 'id' };
  } finally { lock.releaseLock(); }
}

// 自分の数字：配布台帳（送信完了日・文章の番号・Customer List のID）＋ Customer List の返信
// 台帳と Customer List は大きいので、全員分をまとめて1回で計算してキャッシュに置く（cmWarm が10分ごとに作り直す）
function cmStatKey_(name) { return 'cmst:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, cmNorm_(name))).slice(0, 16); }
function cmStats_(name) {
  var hit = CacheService.getScriptCache().get(cmStatKey_(name));
  if (hit) return JSON.parse(hit);
  var all = cmStatsAll_();
  return all[cmNorm_(name)] || cmStatOne_([], {}, cmToday_());
}
function cmStatsAll_() {
  var today = cmToday_();
  var lg = SpreadsheetApp.openById(CM.MASTER_ID).getSheetByName(CM.LEDGER_TAB);
  var lv = lg.getLastRow() > 1 ? lg.getRange(2, 1, lg.getLastRow() - 1, 15).getValues() : [];
  var by = {};
  lv.forEach(function (r) { if (String(r[11]).trim() !== '送信完了') return; var k = cmNorm_(r[2]); (by[k] || (by[k] = [])).push(r); });
  var dest = SpreadsheetApp.openById(CM.MASTER_ID).getSheetByName(CM.DEST_TAB).getRange('A2:A').getValues();
  dest.forEach(function (r) { var k = cmNorm_(r[0]); if (k && !by[k]) by[k] = []; });
  var reply = cmReplies_(), out = {}, put = {};
  Object.keys(by).forEach(function (k) { out[k] = cmStatOne_(by[k], reply, today); put[cmStatKey_(k)] = JSON.stringify(out[k]); });
  try { CacheService.getScriptCache().putAll(put, CM.CACHE_MIN * 60); } catch (e) { console.error(e); }
  return out;
}
function cmStatOne_(mine, reply, today) {
  var month = today.slice(0, 7), byDay = {}, byMsg = {}, rep = 0;
  mine.forEach(function (r) {
    var d = cmDate_(r[12]) || cmDate_(r[1]); if (d) byDay[d] = (byDay[d] || 0) + 1;
    var t = String(r[10] || '').trim() || '—', got = !!reply[String(r[14] || '').trim()];
    var b = byMsg[t] || (byMsg[t] = { n: 0, reply: 0 }); b.n++; if (got) { b.reply++; rep++; }
  });
  var days = [];
  for (var i = 13; i >= 0; i--) { var d = cmAddDays_(today, -i); days.push({ d: d.slice(5), n: byDay[d] || 0 }); }
  var streak = 0, d0 = byDay[today] ? today : cmAddDays_(today, -1);
  while (byDay[d0]) { streak++; d0 = cmAddDays_(d0, -1); }
  var monthN = 0; Object.keys(byDay).forEach(function (d) { if (d.slice(0, 7) === month) monthN += byDay[d]; });
  return { total: mine.length, month: monthN, today: byDay[today] || 0, todayLedger: byDay[today] || 0, reply: rep,
    replyRate: mine.length ? Math.round(rep / mine.length * 1000) / 10 : 0, streak: streak, days: days, byMsg: byMsg };
}
// 10分ごと（cmSetupTrigger で作る）：全員分の数字を先に作っておく（ページを開いたときに待たせない）
function cmWarm() { cmStatsAll_(); }
function cmSetupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'cmWarm') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('cmWarm').timeBased().everyMinutes(10).create();
  cmWarm();
}

// Customer List：返信（K列）が入っている管理ID
function cmReplies_() {
  var sh = SpreadsheetApp.openById(CM.LIST_ID).getSheetByName(CM.LIST_TAB), n = sh.getLastRow() - 1, out = {};
  if (n < 1) return out;
  var ids = sh.getRange(2, 1, n, 1).getValues(), rep = sh.getRange(2, 11, n, 1).getValues();
  for (var i = 0; i < n; i++) if (String(rep[i][0]).trim() !== '') out[String(ids[i][0]).trim()] = 1;
  return out;
}

// さがす：Customer List の D列（URL）と I列（Instagram）にそのユーザー名がいるか
function cmCheck_(name, req) {
  var u = cmUser_(req.q); if (!u) return { ok: false, error: 'q' };
  var sh = SpreadsheetApp.openById(CM.LIST_ID).getSheetByName(CM.LIST_TAB), n = sh.getLastRow() - 1;
  var v = n > 0 ? sh.getRange(2, 1, n, 9).getValues() : [];
  for (var i = v.length - 1; i >= 0; i--) {
    if (cmUser_(v[i][8]) === u || cmUser_(v[i][3]) === u) {
      var by = String(v[i][2] || '').trim();
      return { ok: true, user: u, kind: cmNorm_(by) === cmNorm_(name) ? 'mine' : 'others', by: by, date: cmDate_(v[i][1]), disp: String(v[i][4] || '') };
    }
  }
  return { ok: true, user: u, kind: 'new', list: 'https://docs.google.com/spreadsheets/d/' + CM.LIST_ID + '/edit#gid=0' };
}

// ================= 最初に1回・人が増えたとき =================
// cmIssueKeys：配布先の全員に合言葉を作り、(元データ) の「個人ページURL」タブに 名前・URL を書く（もう持っている人は同じURLのまま）
function cmIssueKeys() {
  var keys = cmKeys_(), byName = {};
  Object.keys(keys).forEach(function (k) { byName[cmNorm_(keys[k])] = k; });
  var ss = SpreadsheetApp.openById(CM.MASTER_ID), v = ss.getSheetByName(CM.DEST_TAB).getDataRange().getValues(), out = [['受講生', '個人ページURL（本人だけに渡す）']];
  for (var i = 1; i < v.length; i++) {
    var name = String(v[i][0] || '').trim(); if (!name || !cmSheetId_(v[i][3])) continue;
    var k = byName[cmNorm_(name)];
    if (!k) { k = Utilities.getUuid().replace(/-/g, '').slice(0, 24); keys[k] = name; byName[cmNorm_(name)] = k; }
    out.push([name, CM.APP_BASE + k]);
  }
  PropertiesService.getScriptProperties().setProperty('CM_KEYS', JSON.stringify(keys));
  var sh = ss.getSheetByName(CM.URL_TAB) || ss.insertSheet(CM.URL_TAB);
  sh.clearContents(); sh.getRange(1, 1, out.length, 2).setValues(out); sh.setFrozenRows(1);
  console.log(out.map(function (r) { return r.join('  '); }).join('\n'));
}

// 動作確認（エディタで実行）：配布先の最初の人の画面データをログに出す（書きこみはしない）
function cmTestMe() {
  var v = SpreadsheetApp.openById(CM.MASTER_ID).getSheetByName(CM.DEST_TAB).getRange(2, 1).getValue();
  var P = cmPerson_(v), j = cmMe_(P);
  console.log(P.name + '：カード ' + j.cards.length + '件・今日 ' + j.stats.today + '・今月 ' + j.stats.month + '・累計 ' + j.stats.total + '・返信 ' + j.stats.reply);
  if (j.cards[0]) console.log(JSON.stringify(j.cards[0]).slice(0, 400));
}
