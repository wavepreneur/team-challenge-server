export type LevelConfig = {
  index: number;
  prompt: string;
  code: string;
};

export type TeamLevelConfig = {
  teamId: string;
  teamName?: string;
  levels: LevelConfig[];
  finalCode: string;
};

export type EventConfig = {
  id: string;
  name: string;
  logoUrl?: string;
  countdownSec: number;
  mode: 'shared' | 'individual';
  levels: LevelConfig[]; // For shared mode
  teamLevels: TeamLevelConfig[]; // For individual mode
  finalCode: string; // For shared mode
  finishMediaUrl?: string;
  caseInsensitive: boolean;
  createdAt: number;
};

export type TeamState = {
  id: string;
  name: string;
  currentLevel: number;
  solvedCount: number;
  finished: boolean;
  elapsedMs: number;
  joinedAt: number;
};

export type EventState = {
  event: EventConfig;
  teams: TeamState[];
  countdown: {
    startedAtMs: number | null;
    pausedAtMs: number | null;
    remainingMs: number;
    isRunning: boolean;
  };
};

export type ClientRequest =
  | { type: 'hello'; role: 'admin' | 'beamer' | 'team'; eventId?: string; teamName?: string }
  | { type: 'create_event'; payload: Omit<EventConfig, 'id' | 'createdAt'> }
  | { type: 'countdown_control'; action: 'start' | 'pause' | 'resume' | 'reset' }
  | { type: 'submit_answer'; payload: { code: string } };

export type ServerResponse =
  | { type: 'event_created'; eventId: string }
  | { type: 'state'; payload: EventState }
  | { type: 'error'; message: string };

export type AnyFromServer = ServerResponse;
export type CreateEventMsg = ClientRequest & { type: 'create_event' };
export type ServerEventIdMsg = ServerResponse & { type: 'event_created' };
export type ServerStateMsg = ServerResponse & { type: 'state' };