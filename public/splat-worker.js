const data = {}
let gaussians
let depthIndex

onmessage = function(event) {
    if (event.data.gaussians) {
        gaussians = event.data.gaussians
        gaussians.totalCount = gaussians.count

        depthIndex = new Uint32Array(gaussians.count)

        data.positions = new Float32Array(gaussians.count * 3)
        data.opacities = new Float32Array(gaussians.count)
        data.cov3Da = new Float32Array(gaussians.count * 3)
        data.cov3Db = new Float32Array(gaussians.count * 3)
        data.colors = new Float32Array(gaussians.count * 3)
    }
    else if (event.data.viewMatrix) {
        const { viewMatrix, maxGaussians } = event.data

        const start = performance.now()
        gaussians.count = Math.min(gaussians.totalCount, maxGaussians)

        sortGaussiansByDepth(depthIndex, gaussians, viewMatrix)

        for (let j = 0; j < gaussians.count; j++) {
            const i = depthIndex[j]

            data.colors[j*3]   = gaussians.colors[i*3]
            data.colors[j*3+1] = gaussians.colors[i*3+1]
            data.colors[j*3+2] = gaussians.colors[i*3+2]

            data.positions[j*3]   = gaussians.positions[i*3]
            data.positions[j*3+1] = gaussians.positions[i*3+1]
            data.positions[j*3+2] = gaussians.positions[i*3+2]

            data.opacities[j] = gaussians.opacities[i]

            data.cov3Da[j*3]   = gaussians.cov3Ds[i*6]
            data.cov3Da[j*3+1] = gaussians.cov3Ds[i*6+1]
            data.cov3Da[j*3+2] = gaussians.cov3Ds[i*6+2]

            data.cov3Db[j*3]   = gaussians.cov3Ds[i*6+3]
            data.cov3Db[j*3+1] = gaussians.cov3Ds[i*6+4]
            data.cov3Db[j*3+2] = gaussians.cov3Ds[i*6+5]
        }

        const sortTime = ((performance.now() - start)/1000).toFixed(3) + 's'
        postMessage({ data, sortTime })
    }
}

function sortGaussiansByDepth(depthIndex, gaussians, viewMatrix) {
    const calcDepth = (i) =>
        gaussians.positions[i*3]   * viewMatrix[2] +
        gaussians.positions[i*3+1] * viewMatrix[6] +
        gaussians.positions[i*3+2] * viewMatrix[10]

    let maxDepth = -Infinity
    let minDepth = Infinity
    const sizeList = new Int32Array(gaussians.count)

    for (let i = 0; i < gaussians.count; i++) {
        const depth = (calcDepth(i) * 4096) | 0
        sizeList[i] = depth
        if (depth > maxDepth) maxDepth = depth
        if (depth < minDepth) minDepth = depth
    }

    const depthInv = (256 * 256) / (maxDepth - minDepth)
    const counts0 = new Uint32Array(256 * 256)

    for (let i = 0; i < gaussians.count; i++) {
        sizeList[i] = ((sizeList[i] - minDepth) * depthInv) | 0
        counts0[sizeList[i]]++
    }

    const starts0 = new Uint32Array(256 * 256)
    for (let i = 1; i < 256 * 256; i++) starts0[i] = starts0[i-1] + counts0[i-1]
    for (let i = 0; i < gaussians.count; i++) depthIndex[starts0[sizeList[i]]++] = i
}
