# 上线以后，怎么看有没有人需要

介绍页：https://photoport-local.pages.dev/zh/

代码与下载：https://github.com/marlon-z/web-photoport

现在提供免费本机版下载，以及在线版兴趣报名。在线导出服务还没有开放，也没有收款。

## 先看这三件事

1. **有没有人来看。** GitHub 仓库打开 Insights → Traffic，看访问和克隆；介绍页打开 Cloudflare → Workers & Pages → photoport-local → Metrics → View Web Analytics。统计有延迟，自己的测试访问也会计算在内。GitHub 的流量页面只保留最近 14 天，建议自己每周记一次汇总。
2. **有没有人真的使用。** 下载次数只能说明下载过，不能证明成功完成导出。本机工具没有上传使用记录，因此目前需要用户自愿反馈结果和遇到的问题。不要让用户在公开 Issue 上传原图、邮箱、密钥或客户表格。
3. **有没有人愿意省去安装步骤。** 看在线版报名中的用途、文件大小、预期结果和价格意向。表单中的每次 19 美元是意向问题，还不是定价承诺，也不是订单。

## 报名资料在哪里

登录自己的 Cloudflare，打开 D1 → photoport-waitlist。数据库是私有的，网页没有公开名单接口。

Console 中可先看汇总，不必导出邮箱：

```sql
SELECT COUNT(*) AS submissions, COUNT(DISTINCT email) AS distinct_emails FROM waitlist;
SELECT scenario, COUNT(*) AS submissions FROM waitlist GROUP BY scenario;
SELECT price_interest, COUNT(*) AS submissions FROM waitlist GROUP BY price_interest;
```

同一个邮箱可以重复提交，所以“报名条数”和“不同邮箱数”不同。邮箱没有验证，报名也不能当作真实付费用户数。个人明细通过私有数据库查看，不要复制到 GitHub 或介绍页。

用户提交后会得到专属删除链接。打开链接可以删除那一次报名。系统不会自动发送邮件。

## 怎么控制费用和数量

本机版由用户自己的电脑下载、整理文件，不消耗你的 R2 或导出服务器。介绍页、报名接口和小型报名数据库使用 Cloudflare 免费方案；安装包和生成示例放在 GitHub Release。

请保持 Workers Free，不主动升级付费计划。免费额度是账号内共享的，达到平台限额时可能停止响应。网站还限制有效提交尝试：每个 IP 每小时 5 次、每天 100 次、整轮 1,000 次。删除报名不会返还尝试次数。这些限制用于控制试用规模，不能替代对账号套餐的检查。

想暂停收集：Pages 项目 Settings → Variables and secrets，把生产环境 SIGNUPS_OPEN 改成 false，再重新部署。已经报名的用户仍能用自己的链接删除记录。

当前使用免费的 pages.dev 地址，不必先买域名。未来如果要升级套餐、运行在线导出或正式收款，应另算预算；当前报名不触发这些服务。
