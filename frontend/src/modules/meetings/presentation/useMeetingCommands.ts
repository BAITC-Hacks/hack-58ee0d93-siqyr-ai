import { useServices } from '../../workspace/presentation/WorkspaceProvider.tsx';
import { useWorkspaceMutation } from '../../workspace/presentation/useWorkspaceMutation.ts';
import type { MeetingChanges, SegmentInput } from '../domain/meeting.types.ts';

export function useMeetingCommands() {
  const { meetings } = useServices();
  const create = useWorkspaceMutation(meetings.create);
  const update = useWorkspaceMutation(({ id, patch }: { id: string; patch: MeetingChanges }) => meetings.update(id, patch));
  const remove = useWorkspaceMutation(meetings.remove);
  const participants = useWorkspaceMutation(({ id, text }: { id: string; text: string }) => meetings.saveParticipants(id, text));
  const segment = useWorkspaceMutation(({ id, input }: { id: string; input: SegmentInput }) => meetings.saveSegment(id, input));
  return {
    createMeeting: create.mutateAsync,
    updateMeeting: (id: string, patch: MeetingChanges) => update.mutateAsync({ id, patch }),
    deleteMeeting: remove.mutateAsync,
    saveParticipants: (id: string, text: string) => participants.mutateAsync({ id, text }),
    saveSegment: (id: string, input: SegmentInput) => segment.mutateAsync({ id, input }),
  };
}
