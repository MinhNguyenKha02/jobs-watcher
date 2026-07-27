export interface Job {
  _id?: string;
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

export interface JobDetails {
  responsibilities?: string;
  requirements?: string;
  benefits?: string;
  companyInfo?: string;
  contact?: string;
  applicationProcess?: string;
  additionalInfo?: string;
  pay?: string;
  jobType?: string;
  extraSections?: Record<string, string>;
}
