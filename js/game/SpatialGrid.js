const emptyCell = Object.freeze([]);

export class SpatialGrid {
    constructor(cellSize = 128) {
        this.cellSize = cellSize;
        this.rows = new Map();
    }

    insert(item, minX, minY, maxX, maxY) {
        const firstColumn = Math.floor(minX / this.cellSize);
        const lastColumn = Math.floor(maxX / this.cellSize);
        const firstRow = Math.floor(minY / this.cellSize);
        const lastRow = Math.floor(maxY / this.cellSize);
        for (let y = firstRow; y <= lastRow; y++) {
            if (!this.rows.has(y)) this.rows.set(y, new Map());
            const row = this.rows.get(y);
            for (let x = firstColumn; x <= lastColumn; x++) {
                if (!row.has(x)) row.set(x, []);
                row.get(x).push(item);
            }
        }
    }

    at(x, y) {
        return this.rows.get(Math.floor(y / this.cellSize))
            ?.get(Math.floor(x / this.cellSize)) ?? emptyCell;
    }
}
