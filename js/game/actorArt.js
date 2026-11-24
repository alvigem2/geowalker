const people = {
    player: { shirt: '#207c71', light: '#69e0ba', skin: '#e7ad79', hair: '#30293b' },
    pedestrianA: { shirt: '#9a4b3e', light: '#f2a46e', skin: '#a77152', hair: '#302627' },
    pedestrianB: { shirt: '#534c83', light: '#c4a6e8', skin: '#dfae84', hair: '#59432f' }
};

const vehicles = {
    car: { paint: '#a83d43', roof: '#eb6e65', truck: false },
    taxi: { paint: '#a57528', roof: '#f7ca55', truck: false },
    truck: { paint: '#365772', roof: '#87b7cf', truck: true }
};

function rect(context, color, x, y, width, height) {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
}

function shadow(context, x, y, width, height) {
    context.fillStyle = 'rgba(23,32,36,.38)';
    context.beginPath();
    context.ellipse(x, y, width, height, 0, 0, Math.PI * 2);
    context.fill();
}

function drawPerson(context, palette, stride) {
    shadow(context, 12, 28, 8, 2);
    const leftShoe = 24 + Math.max(stride, 0);
    const rightShoe = 24 + Math.max(-stride, 0);
    rect(context, '#293744', 8, 18, 4, leftShoe - 17);
    rect(context, '#384957', 12, 18, 4, rightShoe - 17);
    rect(context, '#18262f', 7, leftShoe, 5, 2);
    rect(context, '#18262f', 12, rightShoe, 5, 2);
    rect(context, '#273744', 5, 12, 4, 8);
    rect(context, palette.shirt, 7, 11, 10, 9);
    rect(context, palette.light, 9, 12, 7, 2);
    rect(context, palette.shirt, 16, 12, 3, 5);
    rect(context, palette.skin, 17, 16, 2, 4);
    rect(context, palette.hair, 8, 3, 9, 7);
    rect(context, palette.skin, 10, 6, 8, 5);
    rect(context, palette.hair, 15, 7, 2, 1);
}

function drawVehicle(context, palette) {
    shadow(context, 17, 14, 15, 7);
    rect(context, '#26323b', 5, 5, 6, 15);
    rect(context, '#26323b', 23, 5, 5, 15);
    rect(context, palette.paint, 2, 6, 29, 13);
    rect(context, palette.roof, 4, 7, 25, 10);
    rect(context, '#385b6b', 23, 8, 4, 8);
    if (palette.truck) {
        rect(context, '#536977', 3, 7, 18, 11);
        rect(context, '#9cade0', 5, 8, 14, 2);
    } else {
        rect(context, '#456876', 7, 8, 4, 8);
        rect(context, palette.paint, 12, 8, 9, 1);
    }
    rect(context, '#fff6c5', 29, 7, 2, 3);
    rect(context, '#fff6c5', 29, 15, 2, 3);
    rect(context, '#fa8a6e', 2, 7, 2, 3);
    rect(context, '#fa8a6e', 2, 15, 2, 3);
}

export function prepareActorTextures(textures) {
    for (const [name, palette] of Object.entries(people)) {
        for (const [frame, stride] of [['idle', 0], ['left', 2], ['right', -2]]) {
            const key = personTexture(name, frame);
            if (textures.exists(key)) continue;
            const canvas = textures.createCanvas(key, 24, 30);
            drawPerson(canvas.getContext(), palette, stride);
            canvas.refresh();
        }
    }
    for (const [name, palette] of Object.entries(vehicles)) {
        const key = vehicleTexture(name);
        if (textures.exists(key)) continue;
        const canvas = textures.createCanvas(key, 34, 24);
        drawVehicle(canvas.getContext(), palette);
        canvas.refresh();
    }
}

export function personTexture(name, frame = 'idle') {
    return 'geo-person-' + name + '-' + frame;
}

export function vehicleTexture(name) {
    return 'geo-vehicle-' + name;
}

export function animatePerson(sprite, name, dx, dy, time) {
    const frame = dx || dy ? (Math.floor(time / 125) % 2 ? 'left' : 'right') : 'idle';
    const key = personTexture(name, frame);
    if (sprite.texture.key !== key) sprite.setTexture(key);
    if (Math.abs(dx) > 0.01) sprite.setFlipX(dx < 0);
}
