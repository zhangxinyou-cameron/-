# 仓库协作约定

用户要求 Gitee 与 GitHub 两个仓库同步更新：

- Gitee：https://gitee.com/zhang-xinyou/wisdom-cultivator
- GitHub：https://github.com/zhangxinyou-cameron/-

完成用户授权的代码修改、检查与提交后，推送到两个仓库，并核对远程提交一致。保留已有历史，不默认强制推送。

本工作区 origin 配置了两个 push URL，将配置时的本地主分支同步到两端 master/main。使用不额外指定分支的 `git push`，或在本地 main/master 上运行 `scripts/Sync-Repositories.ps1`，可更新两个平台的默认分支。映射固定到本地主分支，不会因为切换到特性分支就将其覆盖到远程默认分支。

新克隆的仓库不会携带本地 Git 配置。先运行 `scripts/Sync-Repositories.ps1 -ConfigureOnly`，之后再提交和推送。若远程有新提交，先拉取并整合，不能覆盖他人的修改。若部分推送失败，明确报告哪一端成功、哪一端失败，修复后重试并核验。

源码位于 tech-practice/。不要提交个人学习数据库、下载的工具链、node_modules、测试数据、缓存或打包产物。
