// message is sent at 40ms and it will make the other users movement jitter or jump to make it smooth
// extablishing this sequence

interface PositionSample {
    x: number;
    y: number;
    ts: number;
}

// One instance per remote user
export class CursorInterpolator {
    // FIX: was storing only prev/curr (2 samples). With updates every 40ms and
    // a 100ms render delay, "now - 100ms" often fell BEFORE both stored samples,
    // making t go negative, clamping to 0, and freezing the cursor at prev.
    // A buffer of recent samples lets us always find the two samples that
    // actually surround our target render time.
    private samples: PositionSample[] = [];
    private readonly RENDER_DELAY_MS = 100;

    addSample(x: number, y: number, ts: number) {
        this.samples.push({ x, y, ts });

        // keep only recent samples so this never grows unbounded
        if (this.samples.length > 20) {
            this.samples.shift();
        }
    }

    // Calling every animation frame with the current time (Date.now())
    getInterpolatedPosition(now: number): { x: number; y: number } | null {
        if (this.samples.length === 0) return null;

        if (this.samples.length === 1) {
            return { x: this.samples[0].x, y: this.samples[0].y };
        }

        // Render ~100ms in the "past" — this guarantees we always have two real
        // samples to interpolate BETWEEN, (extrapolation)
        // intentianally rendering the curser behind 100ms because if bad network occurs we can give enought 
        // time to render the next position of the mouse 
        const targetTime = now - this.RENDER_DELAY_MS;

        // find the two samples that actually surround targetTime
        let prev = this.samples[0];
        let curr = this.samples[1];

        for (let i = 0; i < this.samples.length - 1; i++) {
            const a = this.samples[i];
            const b = this.samples[i + 1];
            if (a.ts <= targetTime && targetTime <= b.ts) {
                prev = a;
                curr = b;
                break;
            }
        }

        const span = curr.ts - prev.ts;
        if (span <= 0) return { x: curr.x, y: curr.y };

        const t = (targetTime - prev.ts) / span;
        const clampedT = Math.max(0, Math.min(1, t));  // only expetced t are t=0 (beginning) t=0.5(half) t=1 end 

        return {
            x: prev.x + (curr.x - prev.x) * clampedT,
            y: prev.y + (curr.y - prev.y) * clampedT,
        };
    }
}