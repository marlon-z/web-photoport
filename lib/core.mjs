import {translate} from '../public/i18n.js';
import { createHash, randomUUID } from 'node:crypto';
import { archiveRows } from './names.mjs';
import { cellText, quoteCSV } from './metadata.mjs';
import { FILE_TYPES, matchesFile } from './file-types.mjs';

export const LIMITS = Object.freeze({ files: 15000, fileBytes: 20 * 1024 * 1024, totalBytes: 10 * 1024 ** 3, sample: 20 });
export class AppError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const digest = data => createHash('sha256').update(data).digest('hex');
export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const types = FILE_TYPES;
export function imageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}
export function buildPlan(records, fields, labelField, {previewOnly=false}={}) {
  if (!Array.isArray(fields) || fields.length === 0) throw new AppError('fields', '请至少选择一列照片。');
  const rows = [], seen = new Set();
  for (const record of records) for (const field of fields) {
    const attachments = record.fields?.[field] ?? [];
    if (!Array.isArray(attachments)) continue;
    for (const file of attachments) {
      if (!file?.id || !record.id) throw new AppError('record', '来源缺少记录或附件编号，无法安全对应照片。');
      const identity = `${record.id}/${field}/${file.id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const reason = !types[file.type] ? '暂不支持这种附件格式，请查看支持范围' :
        (!Number.isSafeInteger(file.size) || file.size < 1)&&!file.metadataUnknown ? '文件大小未知，无法预先核对' :
        file.size > LIMITS.fileBytes ? '单张超过 20 MB 上限' : '';
      rows.push({ identity, recordId: record.id, fieldId: field, attachmentId: file.id,
        label: labelField ? record.display?.[labelField]??cellText(record.fields?.[labelField]) : record.id,
        filename: String(file.filename ?? file.id), declaredBytes: file.size ?? 0, type: file.type,
        extension: types[file.type] ?? 'bin', metadataUnknown:!!file.metadataUnknown,status: reason ? 'rejected' : 'pending', error: reason,
        bytes: 0, sha256: '', url: '', attempts: 0, verification: '' });
      if (rows.length > LIMITS.files) throw new AppError('file_limit', '本次超过 15000 个附件，请拆成更小的表格或视图。');
    }
  }
  const plannedBytes = rows.filter(x => x.status !== 'rejected').reduce((n, x) => n + x.declaredBytes, 0);
  if (plannedBytes > LIMITS.totalBytes&&!previewOnly) throw new AppError('total_limit', '本次图片总量超过 10 GB，请缩小范围。');
  return { rows, plannedBytes, records: records.length };
}
export function objectKey(jobId, row) {
  const identity=row.identity??`${row.recordId}/${row.fieldId}/${row.attachmentId}`;
  return `photoport-tests/${jobId}/${digest(Buffer.from(identity)).slice(0, 32)}.${row.extension}`;
}
export function csv(rows,organization={},recordData=null,locale="zh-CN") {
  const columns = ['status','record_id','label','field_id','attachment_id','original_filename','new_url','sha256','bytes','error','download_path'];
  const fields=recordData?.fields.filter(f=>f.type!=='multipleAttachments')??[];
  const records=new Map(recordData?.records.map(r=>[r.id,r])??[]);
  return '\ufeff' + [[...columns,...fields.map(f=>translate('原表：{0}',locale,[f.name]))], ...archiveRows(rows,organization,recordData,locale).map(r => [r.status,r.recordId,r.label,r.fieldId,r.attachmentId,r.filename,r.status === 'success' ? r.url : '',r.sha256,r.bytes,translate(r.error,locale),r.downloadPath,...fields.map(f=>records.get(r.recordId)?.display[f.id]??'')])]
    .map(r => r.map(quoteCSV).join(',')).join('\r\n');
}
export class TransferJob {
  constructor(plan, source, destination, {concurrency=2}={}) {
    if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new AppError('concurrency','同时处理数量应为1至8张。');
    this.concurrency=concurrency;
    this.id = randomUUID(); this.rows = plan.rows; this.source = source; this.destination = destination;
    this.records = plan.records; this.plannedBytes = plan.plannedBytes; this.createdAt = new Date().toISOString();
    this.state = 'ready'; this.busy = false; this.cancelled = false; this.startedAt = null;
    this.finishedAt = null; this.lastAction = ''; this.verifiedAt = null;
    this.onState=async()=>{};this.saveError='';this.metrics={peakRSSBytes:0};
  }
  summary() {
    const count = state => this.rows.filter(x => x.status === state).length;
    return { id:this.id, state:this.state, busy:this.busy, createdAt:this.createdAt, startedAt:this.startedAt,
      finishedAt:this.finishedAt, sourceMode:this.source.mode, destinationMode:this.destination.mode,
      total:this.rows.length, records:this.records, plannedBytes:this.plannedBytes,concurrency:this.concurrency,
      success:count('success'), failed:count('failed'), rejected:count('rejected'),
      pending:count('pending'), copying:count('copying'),
      copiedBytes:this.rows.reduce((n,r) => n + (r.status === 'success' ? r.bytes : 0),0),
      attempts:this.rows.reduce((n,r) => n + r.attempts,0), verifiedAt:this.verifiedAt,saveError:this.saveError,metrics:{...this.metrics,sourceNetworkRetries:(this.metrics.sourceNetworkRetries??0)+(this.source.networkRetries??0)},
      organization:this.organization??{},recordData:this.recordData??null,layoutVersion:this.layoutVersion??0,
      rows:this.rows.map(({ identity, ...r }) => ({ ...r, url:r.status === 'success' ? r.url : '' })) };
  }
  async run(action='sample') {
    if(this.plannedBytes>LIMITS.totalBytes)throw new AppError('total_limit','这批附件超过单批上限，请先在预览中选择部分记录。');
    if (this.busy) throw new AppError('busy', '任务正在进行，请先等待或暂停。',409);
    if (!['sample','all','retry'].includes(action)) throw new AppError('action', '不支持的操作。');
    this.busy = true; this.cancelled = false; this.startedAt ??= new Date().toISOString();
    this.lastAction = action; this.state = 'running';
    const memoryTimer=setInterval(()=>{this.metrics.peakRSSBytes=Math.max(this.metrics.peakRSSBytes,process.memoryUsage().rss);},250).unref();
    this.metrics.peakRSSBytes=Math.max(this.metrics.peakRSSBytes,process.memoryUsage().rss);
    await this.onState();
    const candidates = this.rows.filter(r => action === 'retry' ? r.status === 'failed' : r.status === 'pending');
    const selected = action === 'sample' ? candidates.slice(0, LIMITS.sample) : candidates;
    let next = 0,reservedBytes=this.rows.reduce((n,r)=>n+(r.status==='success'?r.bytes:0),0);
    const worker = async () => {
      while (!this.cancelled && next < selected.length) {
        const row = selected[next++]; row.status = 'copying'; row.error = ''; row.url = ''; row.attempts++;
        let reserved=0;
        try {
          let bytes;
          try { bytes = await this.source.read(row, false); }
          catch (e) { if (e.code !== 'source_expired') throw e; bytes = await this.source.read(row, true); }
          if (!bytes?.length || bytes.length > LIMITS.fileBytes) throw new AppError('size', '实际图片大小为空或超过 20 MB。');
          if (!matchesFile(bytes,row.type)) throw new AppError('image', '下载内容不是声明的文件格式，已停止这个附件。');
          if (!row.metadataUnknown&&bytes.length !== row.declaredBytes) throw new AppError('source_changed', '文件大小与扫描时不同，请重新扫描，避免复制错版本。');
          if(reservedBytes+bytes.length>LIMITS.totalBytes)throw new AppError('total_limit','实际附件总量超过10.74GB，请缩小范围后重试。');
          reserved=bytes.length;reservedBytes+=reserved;
          if(row.metadataUnknown){row.declaredBytes=bytes.length;row.metadataUnknown=false;}
          const sha = digest(bytes), key = objectKey(this.id, row);
          await this.destination.put(key, bytes, { type:row.type, sha256:sha });
          const verification = await this.destination.verify(key, sha);
          if (!verification.valid) throw new AppError('verification', '上传后内容核对失败，未生成成功地址。');
          row.bytes = bytes.length; row.sha256 = sha; row.verification = verification.method;
          row.url = this.destination.url(key); row.status = 'success';
        } catch (e) {
          reservedBytes-=reserved;
          row.status = row.metadataUnknown&&e.code==='size'?'rejected':'failed'; row.url = ''; row.error = e instanceof AppError ? e.message : '复制失败，请检查来源和目标权限后重试。';
          if(e.code==='csv_expired')this.pause();
        }
        await this.onState();
      }
    };
    try { await Promise.all(Array.from({length:this.concurrency},()=>worker())); }
    finally {
      clearInterval(memoryTimer);
      this.busy = false; this.finishedAt = new Date().toISOString();
      this.state = this.cancelled ? 'paused' : this.rows.some(r => r.status === 'pending') ? 'sampled' :
        this.rows.some(r => ['failed','rejected'].includes(r.status)) ? 'completed_with_errors' : 'completed';
      await this.onState();
    }
    return this.summary();
  }
  pause() { this.cancelled = true; }
  async verifyAll() {
    if (this.busy) throw new AppError('busy','任务正在进行，请稍后核对。',409);
    this.busy = true;
    try {
      for (const row of this.rows.filter(r => r.status === 'success')) {
        try {
          const result = await this.destination.verify(objectKey(this.id,row),row.sha256);
          if (!result.valid) throw new AppError('verification','目标图片已不存在或内容发生变化。');
          row.verification = result.method;
        } catch { row.status = 'failed'; row.error = '目标图片已不存在、无法读取或内容发生变化。'; row.url = ''; }
      }
      this.verifiedAt = new Date().toISOString();
      if (this.rows.some(r => r.status === 'failed')) this.state = 'completed_with_errors';
    } finally { this.busy = false;await this.onState(); }
    return this.summary();
  }
}
