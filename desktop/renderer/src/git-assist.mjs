export const GIT_ASSIST_LABELS = {
  commit: ['生成提交说明', '提交说明已生成', '提交说明生成失败'],
  pr: ['生成 PR 描述', 'PR 描述已生成', 'PR 描述生成失败'],
  review: ['生成 Review 清单', 'Review 清单已生成', 'Review 清单生成失败'],
  explain: ['解释 diff', 'Diff 解释完成', 'Diff 解释失败'],
};

export function getGitAssistLabels(intent) {
  return GIT_ASSIST_LABELS[intent] || GIT_ASSIST_LABELS.explain;
}

export function buildGitAssistPrompt({ intent, filePath, diff }) {
  const trimmedDiff = String(diff || '').trim();
  if (!filePath || !trimmedDiff) return '';

  const promptByIntent = {
    commit: [
      `请基于下面这个 Git diff 草拟一条清晰的 commit message。`,
      `要求：`,
      `- 使用 Conventional Commits 风格`,
      `- 只输出建议的标题和 2-4 条要点`,
      `- 不要执行 git 命令`,
    ],
    pr: [
      `请基于下面这个 Git diff 草拟一份 PR 描述。`,
      `要求：`,
      `- 用中文输出`,
      `- 包含 Summary、Changes、Test Plan、Risks 四个小节`,
      `- Test Plan 只写可以真实执行的验证步骤`,
      `- 不要执行 git 命令`,
    ],
    review: [
      `请基于下面这个 Git diff 生成一份代码 Review checklist。`,
      `要求：`,
      `- 按 Correctness、Tests、Security、Maintainability 分组`,
      `- 每组给出具体检查项，不要泛泛而谈`,
      `- 如果 diff 暴露明显风险，请把它放在列表顶部`,
      `- 不要执行 git 命令`,
    ],
    explain: [
      `请解释下面这个 Git diff。`,
      `请重点说明：`,
      `- 这次变更改变了什么行为`,
      `- 有哪些风险或需要补测的地方`,
      `- 如果你发现明显问题，请直接指出`,
    ],
  };

  return [
    ...(promptByIntent[intent] || promptByIntent.explain),
    ``,
    `文件：${filePath}`,
    ``,
    '```diff',
    trimmedDiff,
    '```',
  ].join('\n');
}
