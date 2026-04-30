function formatAgentList(result) {
  const lines = ['Available agent types:', ''];

  for (const agent of result.activeAgents) {
    const source = agent.source ? ` [${agent.source}]` : '';
    const tools = agent.tools.length > 0 ? agent.tools.join(', ') : 'all tools';
    lines.push(`- ${agent.agentType}${source}`);
    lines.push(`  role: ${agent.role || agent.whenToUse || 'General teammate'}`);
    lines.push(`  tools: ${tools}`);
    if (agent.model) {
      lines.push(`  model: ${agent.model}`);
    }
  }

  if (result.failedFiles && result.failedFiles.length > 0) {
    lines.push('', 'Failed agent files:');
    for (const failure of result.failedFiles) {
      lines.push(`- ${failure.path}: ${failure.error}`);
    }
  }

  return lines.join('\n');
}

function formatTeamSnapshot(snapshot) {
  const lines = [
    `Team: ${snapshot.teamName}`,
    `Mission: ${snapshot.mission || '(none)'}`,
    `State: ${snapshot.path}`,
    '',
    'Members:',
  ];

  if (snapshot.members.length === 0) {
    lines.push('- none');
  } else {
    for (const member of snapshot.members) {
      const model = member.model ? ` model=${member.model}` : '';
      const currentTask = member.currentTaskId ? ` task=${member.currentTaskId}` : '';
      lines.push(`- ${member.name} (${member.agentType}) [${member.status}]${model}${currentTask}`);
      lines.push(`  role: ${member.role || 'General teammate'}`);
    }
  }

  lines.push('', 'Tasks:');
  if (snapshot.tasks.length === 0) {
    lines.push('- none');
  } else {
    for (const task of snapshot.tasks) {
      const dependencies = task.dependsOn.length > 0 ? task.dependsOn.join(', ') : 'none';
      lines.push(`- ${task.id} [${task.status}] ${task.title}`);
      lines.push(`  owner: ${task.owner || 'unassigned'} · depends on: ${dependencies}`);
      if (task.deliverable) {
        lines.push(`  deliverable: ${task.deliverable}`);
      }
      if (task.error) {
        lines.push(`  error: ${task.error.message || task.error}`);
      }
    }
  }

  lines.push('', formatProgress(snapshot.progress));
  return lines.join('\n');
}

function formatTeamList(teams) {
  if (teams.length === 0) {
    return 'No teams found.';
  }

  const lines = ['Teams:', ''];
  for (const team of teams) {
    const updated = team.updatedAt ? new Date(team.updatedAt).toLocaleString() : 'unknown';
    lines.push(`- ${team.name}: ${team.members} members, ${team.tasks} tasks, updated ${updated}`);
    if (team.mission) {
      lines.push(`  mission: ${team.mission}`);
    }
    if (team.error) {
      lines.push(`  error: ${team.error}`);
    }
  }

  return lines.join('\n');
}

function formatRunResult(result) {
  const lines = [
    `Run: ${result.run.id} [${result.run.status}]`,
    formatProgress(result.progress),
    '',
    'Events:',
  ];

  if (result.events.length === 0) {
    lines.push('- no ready tasks');
  } else {
    for (const event of result.events) {
      if (event.status === 'fulfilled') {
        lines.push(`- ${event.taskId}: completed`);
      } else {
        lines.push(`- ${event.taskId}: failed (${event.error.message})`);
      }
    }
  }

  if (result.blocked.length > 0) {
    lines.push('', 'Blocked:');
    for (const task of result.blocked) {
      lines.push(`- ${task.id}: waiting for ${task.dependsOn.join(', ')}`);
    }
  }

  return lines.join('\n');
}

function formatMessages(messages) {
  if (messages.length === 0) {
    return 'No unread messages.';
  }

  return messages.map((message) => {
    const task = message.taskId ? ` ${message.taskId}` : '';
    return `[${message.id}] ${message.from} -> ${message.to}${task}: ${message.body}`;
  }).join('\n');
}

function formatProgress(progress) {
  return `Progress: ${progress.completed}/${progress.total} completed (${progress.percentComplete}%) · ${progress.active} active · ${progress.pending} pending · ${progress.failed} failed`;
}

module.exports = {
  formatAgentList,
  formatMessages,
  formatRunResult,
  formatTeamList,
  formatTeamSnapshot,
};
