function formatTeamPlan(team) {
  const progress = team.board ? team.board.getProgress() : null;
  const agents = team.agents || team.members || [];
  const tasks = team.tasks || [];
  const validation = team.validation || [];
  const lines = [
    `Team: ${team.name}`,
    `Mission: ${team.mission}`,
    '',
    `Agents (${agents.length}):`,
    ...agents.map((a) => `  - ${a.name} (${a.agentType || ''}): ${a.role}`),
    '',
    `Tasks (${tasks.length}):`,
    ...tasks.map(formatTask),
  ];

  if (validation.length > 0) {
    lines.push('', 'Validation:');
    for (const item of validation) {
      lines.push(`  - ${item}`);
    }
  }

  if (progress) {
    lines.push(
      '',
      'Progress:',
      `  - ${progress.completed}/${progress.total} completed (${progress.percentComplete}%)`,
      `  - ${progress.active} active, ${progress.pending} pending, ${progress.failed} failed`,
    );
  }

  return lines.join('\n');
}

function formatTask(task) {
  const mode = task.parallel !== false ? 'parallel' : 'sequential';
  const deps = task.dependsOn && task.dependsOn.length > 0 ? task.dependsOn.join(', ') : 'none';
  const deliverable = task.deliverable ? `\n    deliverable: ${task.deliverable}` : '';
  const agentType = task.agentType ? ` (${task.agentType})` : '';

  return [
    `  - ${task.id} [${mode}] ${task.title}`,
    `    owner: ${task.owner || 'unassigned'}${agentType} · depends on: ${deps}${deliverable}`,
  ].join('\n');
}

module.exports = { formatTeamPlan };
