// templates.source.ts

// templates is recruiter/ats language fit the market driver for profile.source.ts
// templates role is define large set of surfaces lexical over job description (at job postings sites) by reached recruiters searchable
// the surfaces lexical fn (templates, {recruiter_surfaces, retrieval_associations}) of templates.source.ts and relations.source.ts of truth
type Lang = 'en' | 'vi';
type TemplateKind = 'responsibility' | 'requirement' | 'preference';

export const englishTemplates: Record<TemplateKind, string[]> = {
  responsibility: [
    'develop and maintain {surface}',
    'design and implement {surface}',
    'build reliable {surface}',
    'build production-grade {surface}',
    'support production-grade {surface}',
    'integrate and operate {surface}',
    'optimize and troubleshoot {surface}',
    'monitor and optimize {surface}',
    'improve reliability of {surface}',
    'maintain scalable {surface}',
    'build backend systems using {surface}',
    'develop backend services for {surface}',
    'design backend solutions for {surface}',
    'design scalable backend architecture around {surface}',
    'implement high-performance {surface}',
    'develop high-availability {surface}',
    'maintain distributed {surface}',
    'collaborate on backend platform {surface}',
    'participate in developing {surface}',
  ],
  requirement: [
    'experience with {surface}',
    'hands-on experience with {surface}',
    'knowledge of {surface}',
    'understanding of {surface}',
    'practical experience with {surface}',
    'good understanding of {surface}',
    'experience building {surface}',
    'experience operating {surface}',
    'experience designing {surface}',
    'experience deploying {surface}',
    'ability to maintain {surface}',
    'familiarity with {surface}',
    'ability to troubleshoot {surface}',
    'ability to optimize {surface}',
    'experience working with {surface}',
  ],
  preference: [
    'prior exposure to {surface}',
    'experience with {surface} is a plus',
    'knowledge of {surface} is preferred',
    'experience operating large-scale {surface} is preferred',
    'familiarity with distributed {surface} is a plus',
  ],
};

export const vietnameseTemplates: Record<TemplateKind, string[]> = {
  responsibility: [
    'thiết kế và triển khai {surface}',
    'phát triển và duy trì {surface}',
    'xây dựng {surface} ổn định',
    'xây dựng {surface} ở mức production',
    'hỗ trợ vận hành {surface} ở production',
    'tích hợp và vận hành {surface}',
    'tối ưu và xử lý sự cố {surface}',
    'giám sát và tối ưu {surface}',
    'cải thiện độ tin cậy của {surface}',
    'duy trì {surface} có khả năng mở rộng',
    'xây dựng hệ thống backend với {surface}',
    'phát triển dịch vụ backend cho {surface}',
    'thiết kế giải pháp backend cho {surface}',
    'thiết kế kiến trúc backend có khả năng mở rộng quanh {surface}',
    'triển khai {surface} hiệu năng cao',
    'phát triển {surface} sẵn sàng vận hành',
    'duy trì {surface} phân tán',
    'phối hợp phát triển nền tảng backend với {surface}',
    'tham gia phát triển {surface}',
  ],
  requirement: [
    'có kinh nghiệm với {surface}',
    'có kinh nghiệm triển khai {surface}',
    'có kiến thức về {surface}',
    'hiểu biết về {surface}',
    'có kinh nghiệm thực tế với {surface}',
    'am hiểu về {surface}',
    'có kinh nghiệm phát triển {surface}',
    'có kinh nghiệm vận hành {surface}',
    'có kinh nghiệm thiết kế {surface}',
    'có kinh nghiệm triển khai production với {surface}',
    'có khả năng duy trì {surface}',
    'quen thuộc với {surface}',
    'có khả năng xử lý sự cố {surface}',
    'có khả năng tối ưu {surface}',
    'đã từng làm việc với {surface}',
  ],
  preference: [
    'đã từng tiếp xúc với {surface}',
    'có kinh nghiệm với {surface} là lợi thế',
    'ưu tiên ứng viên có kiến thức về {surface}',
    'ưu tiên ứng viên từng vận hành {surface} quy mô lớn',
    'quen thuộc với {surface} phân tán là lợi thế',
  ],
};

export const vendorTemplates: Record<Lang, Record<TemplateKind, string[]>> = {
  en: {
    responsibility: [
      'integrate with {retrieval_association}',
      'operate with {retrieval_association}',
      'support {retrieval_association} workflows',
    ],
    requirement: [
      'experience with {retrieval_association}',
      'working knowledge of {retrieval_association}',
      'ability to integrate {retrieval_association}',
    ],
    preference: ['exposure to {retrieval_association}', 'prior work with {retrieval_association}'],
  },
  vi: {
    responsibility: ['tích hợp với {retrieval_association}', 'vận hành với {retrieval_association}', 'hỗ trợ luồng {retrieval_association}'],
    requirement: [
      'có kinh nghiệm với {retrieval_association}',
      'có hiểu biết về {retrieval_association}',
      'có khả năng tích hợp {retrieval_association}',
    ],
    preference: ['đã từng tiếp xúc với {retrieval_association}', 'đã từng làm việc với {retrieval_association}'],
  },
};
