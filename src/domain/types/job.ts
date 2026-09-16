export interface Job {
  _id: string;
  company: string;
  role: string;
  location?: string;
  description?: string;
  details?: JobDetails;
  salary?: string;
  url?: string;
  deadline?: string;
  easyApply?: boolean;
}

export type JobDetails = string;
