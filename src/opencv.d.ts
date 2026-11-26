declare const cv: any;

interface Window {
  onOpenCvReady: () => void;
  cvReady: boolean;
  cvLoadStatus?: 'loading' | 'ready' | 'error';
  cvLoadError?: string | null;
  loadOpenCvScript?: () => void;
  Module?: {
    onRuntimeInitialized?: () => void;
  };
  cv?: any;
}
