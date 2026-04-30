function formatTeamPlan(team) {
  const progress = team.board ? team.board.getProgress() : null;
  const lines = [
    `Team: ${team.name}`,
    `Mission: ${team.mission}`,
    '',
    'Agents:',
    ...team.agents.map((agent) => `- ${agent.name}: ${agent.role}`),
    '',
    'Parallel Workstreams:',
    ...team.tasks.map(formatTask),
    '',
    'Validation:',
    ...team.validation.map((item) => `- ${item}`),
  ];

  if (progress) {
    lines.push('', 'Progress:', `- ${progress.completed}/${progress.total} completed (${progress.percentComplete}%)`, `- ${progress.active} active, ${progress.pending} pending, ${progress.failed} failed`);
  }

  return lines.join('\n');
}

function formatTask(task) {
  const mode = task.parallel ? 'parallel' : 'sequential';
  const dependencies = task.dependsOn.length > 0 ? task.dependsOn.join(', ') : 'none';

  return `- ${task.id} [${mode}] ${task.title}\n  owner: ${task.owner}\n  depends on: ${dependencies}\n  deliverable: ${task.deliverable}`;
}

module.exports = { formatTeamPlan };
