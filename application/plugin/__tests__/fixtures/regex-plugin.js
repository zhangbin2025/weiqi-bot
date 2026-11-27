function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function parse(input) {
  if (!isObject(input) || !Array.isArray(input.args) || input.args.length !== 1 || !isObject(input.args[0])) {
    throw new Error('输入必须是 {method, args:[参数对象]}');
  }
  var a = input.args[0];
  if (typeof a.text !== 'string' || typeof a.pattern !== 'string') throw new Error('text/pattern 必须是字符串');
  return a;
}
function makeRegex(pattern, flags) {
  if (flags.indexOf('y') >= 0) throw new Error('不支持 sticky 标志 y');
  return new RegExp(pattern, flags);
}
function call(input) {
  if (!isObject(input) || typeof input.method !== 'string') throw new Error('缺少 method');
  var a = parse(input);
  var method = input.method;
  if (method === 'match') {
    var flags = a.flags === undefined ? '' : a.flags;
    if (typeof flags !== 'string' || flags.indexOf('g') >= 0 || flags.indexOf('y') >= 0) {
      throw new Error('match 的 flags 不允许 g/y');
    }
    var re = makeRegex(a.pattern, flags);
    var hit = re.exec(a.text);
    if (!hit) return { matched: false, value: null, index: -1, groups: [] };
    return { matched: true, value: hit[0], index: hit.index, groups: hit.slice(1) };
  }
  if (method === 'extract') {
    var extractFlags = a.flags === undefined ? 'g' : a.flags;
    if (typeof extractFlags !== 'string') throw new Error('flags 必须是字符串');
    if (extractFlags.indexOf('g') < 0) extractFlags += 'g';
    var group = a.group === undefined ? 0 : a.group;
    if (!Number.isInteger(group) || group < 0) throw new Error('group 必须是非负整数');
    var limit = a.limit === undefined ? 0 : a.limit;
    if (!Number.isInteger(limit) || limit < 0) throw new Error('limit 必须是非负整数');
    var unique = a.unique === true;
    var withIndex = a.withIndex === true;
    var extractor = makeRegex(a.pattern, extractFlags);
    var results = [], seen = {};
    var match;
    while ((match = extractor.exec(a.text)) !== null) {
      var value = match[group] === undefined ? '' : match[group];
      var identity = String(value);
      if (!unique || !Object.prototype.hasOwnProperty.call(seen, identity)) {
        seen[identity] = true;
        results.push(withIndex ? { value: value, index: match.index } : value);
      }
      if (limit > 0 && results.length >= limit) break;
      if (match[0] === '') {
        if (extractor.lastIndex >= a.text.length) break;
        var cp = a.text.codePointAt(extractor.lastIndex);
        extractor.lastIndex += cp > 65535 ? 2 : 1;
      }
    }
    return results;
  }
  if (method === 'replace') {
    if (typeof a.replacement !== 'string') throw new Error('replacement 必须是字符串');
    var replaceFlags = a.flags === undefined ? 'g' : a.flags;
    if (typeof replaceFlags !== 'string') throw new Error('flags 必须是字符串');
    return a.text.replace(makeRegex(a.pattern, replaceFlags), a.replacement);
  }
  throw new Error('不支持的 regex action：' + method);
}
