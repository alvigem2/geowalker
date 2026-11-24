export class TouchJoystick {
    constructor(parent) {
        this.x = 0;
        this.y = 0;
        this.pointerId = null;
        this.listeners = new AbortController();
        const options = { signal: this.listeners.signal };

        this.base = document.createElement('div');
        this.base.className = 'touch-joystick';
        this.base.setAttribute('role', 'group');
        this.base.setAttribute('aria-label', 'Joystick de movimiento');
        this.knob = document.createElement('span');
        this.knob.className = 'touch-joystick-knob';
        this.knob.setAttribute('aria-hidden', 'true');
        this.base.append(this.knob);
        parent.append(this.base);

        this.base.addEventListener('pointerdown', event => {
            if (this.pointerId !== null || event.button !== 0) return;
            event.preventDefault();
            this.base.setPointerCapture(event.pointerId);
            this.pointerId = event.pointerId;
            this.move(event);
        }, options);
        this.base.addEventListener('pointermove', event => this.move(event), options);
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
            this.base.addEventListener(type, event => {
                if (this.pointerId === event.pointerId) this.reset();
            }, options);
        }
        window.addEventListener('blur', () => this.reset(), options);
        window.addEventListener('resize', () => this.reset(), options);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.reset();
        }, options);
    }

    move(event) {
        if (event.pointerId !== this.pointerId) return;
        const { left, top, width, height } = this.base.getBoundingClientRect();
        const travel = width * 0.32;
        if (!travel) return;
        const dx = event.clientX - (left + width / 2);
        const dy = event.clientY - (top + height / 2);
        const distance = Math.hypot(dx, dy);
        const strength = Math.min(1, distance / travel);
        const magnitude = Math.max(0, (strength - 0.12) / 0.88);
        this.x = distance ? dx / distance * magnitude : 0;
        this.y = distance ? dy / distance * magnitude : 0;
        const offset = distance ? Math.min(1, travel / distance) : 0;
        this.knob.style.transform = `translate(${dx * offset}px, ${dy * offset}px)`;
    }

    reset() {
        const pointerId = this.pointerId;
        this.pointerId = null;
        this.x = 0;
        this.y = 0;
        this.knob.style.transform = '';
        if (pointerId !== null && this.base.hasPointerCapture(pointerId)) {
            this.base.releasePointerCapture(pointerId);
        }
    }

    destroy() {
        this.reset();
        this.listeners.abort();
        this.base.remove();
    }
}
