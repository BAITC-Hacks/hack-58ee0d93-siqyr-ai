export interface ParticipantLine {
  name: string;
  role: string;
}

/** One participant per line as «Имя — роль», the format the meeting page edits; blank lines are skipped. */
export function parseParticipantLines(text: string): ParticipantLine[] {
  return text.split('\n').map((line) => {
    const [name, ...role] = line.split(/\s+[—–-]\s+/);
    return { name: name?.trim() ?? '', role: role.join(' — ').trim() };
  }).filter((person) => person.name);
}
