// src/utils/idleTimer.ts

export function setupIdleTimer(onIdle: () => void, timeoutMinutes = 15) {
    let idleTimer: ReturnType<typeof setTimeout>;
    const timeoutMs = timeoutMinutes * 60 * 1000;

    function resetTimer() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            onIdle();
        }, timeoutMs);
    }

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];

    events.forEach((event) => {
        window.addEventListener(event, resetTimer);
    });

    resetTimer();

    return () => {
        clearTimeout(idleTimer);
        events.forEach((event) => {
            window.removeEventListener(event, resetTimer);
        });
    };
}