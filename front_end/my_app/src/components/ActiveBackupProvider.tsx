"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  cancelDeviceBackup,
  getDeviceBackupProgress,
  getErrorMessage,
  runCombinedBackup,
  type BackupProgressInfo,
  type BackupRunResult,
  type CombinedBackupPayload,
} from "@/lib/api";
import {
  BackupProgressModal,
  type BackupProgressStatus,
} from "./BackupProgressModal";
import { BackupMiniWidget } from "./BackupMiniWidget";
import { useToast } from "./ToastProvider";

export type ActiveBackupState = {
  isOpen: boolean;
  isMinimized: boolean;
  status: BackupProgressStatus;
  deviceId: number | null;
  deviceName: string;
  backupName: string;
  targetCount: number;
  result: BackupRunResult | null;
  errorMessage: string;
  progressInfo: BackupProgressInfo | null;
  isCancelling: boolean;
};

export type StartBackupOptions = {
  payload: CombinedBackupPayload;
  meta?: {
    deviceName?: string;
    backupName?: string;
    targetCount?: number;
  };
};

export type ActiveBackupContextValue = {
  state: ActiveBackupState;
  isRunning: boolean;
  startBackup: (options: StartBackupOptions) => Promise<BackupRunResult>;
  minimize: () => void;
  maximize: () => void;
  cancelBackup: () => Promise<void>;
  closeModal: () => void;
};

const initialState: ActiveBackupState = {
  isOpen: false,
  isMinimized: false,
  status: "loading",
  deviceId: null,
  deviceName: "",
  backupName: "",
  targetCount: 0,
  result: null,
  errorMessage: "",
  progressInfo: null,
  isCancelling: false,
};

const ActiveBackupContext = createContext<ActiveBackupContextValue | null>(null);

export function ActiveBackupProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [state, setState] = useState<ActiveBackupState>(initialState);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const startPolling = useCallback(
    (deviceId: number) => {
      stopPolling();

      async function poll() {
        try {
          const info = await getDeviceBackupProgress(deviceId);
          if (info && info.status !== "idle") {
            setState((prev) => {
              if (!prev.isOpen) return prev;
              const nextStatus =
                info.status === "cancelled"
                  ? ("cancelled" as const)
                  : prev.status;
              return {
                ...prev,
                progressInfo: info,
                status: nextStatus,
                errorMessage:
                  info.status === "cancelled"
                    ? info.message || "การสำรองข้อมูลถูกยกเลิกแล้ว"
                    : prev.errorMessage,
              };
            });
          }
        } catch {
          // ignore transient poll errors
        }
      }

      void poll();
      pollIntervalRef.current = setInterval(poll, 300);
    },
    [stopPolling]
  );

  const minimize = useCallback(() => {
    setState((prev) => ({ ...prev, isMinimized: true }));
  }, []);

  const maximize = useCallback(() => {
    setState((prev) => ({ ...prev, isMinimized: false }));
  }, []);

  const closeModal = useCallback(() => {
    stopPolling();
    setState(initialState);
  }, [stopPolling]);

  const cancelBackup = useCallback(async () => {
    if (!state.deviceId || state.isCancelling) return;
    setState((prev) => ({ ...prev, isCancelling: true }));
    try {
      await cancelDeviceBackup(state.deviceId);
      showToast({
        tone: "info",
        title: "กำลังยกเลิก",
        message: "ส่งคำขอยกเลิกการสำรองข้อมูลแล้ว",
      });
    } catch (err) {
      showToast({
        tone: "error",
        title: "เกิดข้อผิดพลาด",
        message: getErrorMessage(err, "ไม่สามารถส่งคำขอยกเลิกได้"),
      });
      setState((prev) => ({ ...prev, isCancelling: false }));
    }
  }, [state.deviceId, state.isCancelling, showToast]);

  const startBackup = useCallback(
    async (options: StartBackupOptions): Promise<BackupRunResult> => {
      const { payload, meta } = options;
      const deviceId = payload.device_id;
      const resolvedName = meta?.deviceName || `Device #${deviceId}`;
      const resolvedBackup = payload.backup_name || meta?.backupName || "-";
      const targetCount = meta?.targetCount ?? payload.remote_paths.length;

      setState({
        isOpen: true,
        isMinimized: false,
        status: "loading",
        deviceId,
        deviceName: resolvedName,
        backupName: resolvedBackup,
        targetCount,
        result: null,
        errorMessage: "",
        progressInfo: null,
        isCancelling: false,
      });

      startPolling(deviceId);

      try {
        const response = await runCombinedBackup(payload);

        // Smooth completion: Hold 100% for 650ms so user clearly witnesses the completion
        setState((prev) => ({
          ...prev,
          progressInfo: {
            device_id: deviceId,
            status: "completed",
            stage: "completed",
            overall_percent: 100,
            file_percent: 100,
            current_file: prev.progressInfo?.current_file || "",
            total_files_estimate: prev.progressInfo?.total_files_estimate || 1,
            file_index: prev.progressInfo?.total_files_estimate || 1,
            message: "สำรองข้อมูลเสร็จสิ้นเรียบร้อย (100%)",
          },
        }));

        await new Promise((resolve) => setTimeout(resolve, 650));

        stopPolling();

        setState((prev) => ({
          ...prev,
          status: "success",
          deviceName: response.device_name || resolvedName,
          backupName: response.backup_name,
          result: response,
        }));

        showToast({
          tone: "success",
          title: "สำรองข้อมูลเสร็จสิ้น",
          message: `${response.backup_name} บันทึกเรียบร้อยสำหรับ ${response.device_name}`,
        });

        router.refresh();
        return response;
      } catch (errorResponse) {
        stopPolling();
        const errorMsg = getErrorMessage(
          errorResponse,
          "เกิดข้อผิดพลาดในการสำรองข้อมูล"
        );
        const isCancelled =
          errorMsg.includes("ยกเลิก") || state.isCancelling;

        setState((prev) => ({
          ...prev,
          status: isCancelled ? "cancelled" : "error",
          errorMessage: errorMsg,
          isCancelling: false,
        }));

        showToast({
          tone: isCancelled ? "info" : "error",
          title: isCancelled ? "ยกเลิกแล้ว" : "การสำรองข้อมูลไม่สำเร็จ",
          message: errorMsg,
        });

        throw errorResponse;
      }
    },
    [router, showToast, startPolling, stopPolling, state.isCancelling]
  );

  const isRunning = state.isOpen && state.status === "loading";

  const contextValue = useMemo<ActiveBackupContextValue>(
    () => ({
      state,
      isRunning,
      startBackup,
      minimize,
      maximize,
      cancelBackup,
      closeModal,
    }),
    [state, isRunning, startBackup, minimize, maximize, cancelBackup, closeModal]
  );

  return (
    <ActiveBackupContext.Provider value={contextValue}>
      {children}

      {/* Full Screen Detailed Modal */}
      {state.isOpen && !state.isMinimized ? (
        <BackupProgressModal
          isOpen={true}
          status={state.status}
          deviceName={state.deviceName}
          backupName={state.backupName}
          targetCount={state.targetCount}
          result={state.result}
          errorMessage={state.errorMessage}
          progressInfo={state.progressInfo}
          isCancelling={state.isCancelling}
          onMinimize={minimize}
          onCancel={cancelBackup}
          onClose={closeModal}
        />
      ) : null}

      {/* Floating Minimized Card (Allows viewing other pages in background) */}
      {state.isOpen && state.isMinimized ? (
        <BackupMiniWidget
          status={state.status}
          deviceName={state.deviceName}
          backupName={state.backupName}
          result={state.result}
          errorMessage={state.errorMessage}
          progressInfo={state.progressInfo}
          isCancelling={state.isCancelling}
          onMaximize={maximize}
          onCancel={cancelBackup}
          onClose={closeModal}
        />
      ) : null}
    </ActiveBackupContext.Provider>
  );
}

export function useActiveBackup(): ActiveBackupContextValue {
  const context = useContext(ActiveBackupContext);
  if (!context) {
    throw new Error("useActiveBackup must be used within an ActiveBackupProvider");
  }
  return context;
}

