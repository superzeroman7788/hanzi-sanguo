import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 3 else {
    fputs("usage: remove-light-background input.png output.png\n", stderr)
    exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

guard
    let source = CGImageSourceCreateWithURL(inputURL as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
    fputs("failed to read input image\n", stderr)
    exit(3)
}

let width = image.width
let height = image.height
let bytesPerRow = width * 4
var pixels = [UInt8](repeating: 0, count: height * bytesPerRow)

guard let context = CGContext(
    data: &pixels,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fputs("failed to create bitmap context\n", stderr)
    exit(4)
}

context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

for offset in stride(from: 0, to: pixels.count, by: 4) {
    let red = Double(pixels[offset])
    let green = Double(pixels[offset + 1])
    let blue = Double(pixels[offset + 2])
    let luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722

    let alphaFactor: Double
    if luminance >= 232 {
        alphaFactor = 0
    } else if luminance > 182 {
        alphaFactor = (232 - luminance) / 50
    } else {
        alphaFactor = 1
    }

    let oldAlpha = Double(pixels[offset + 3])
    if alphaFactor < 1 {
        pixels[offset] = 0
        pixels[offset + 1] = 0
        pixels[offset + 2] = 0
    }
    pixels[offset + 3] = UInt8(max(0, min(255, oldAlpha * alphaFactor)))
}

guard let outputImage = context.makeImage() else {
    fputs("failed to create output image\n", stderr)
    exit(5)
}

guard let destination = CGImageDestinationCreateWithURL(
    outputURL as CFURL,
    UTType.png.identifier as CFString,
    1,
    nil
) else {
    fputs("failed to create PNG destination\n", stderr)
    exit(6)
}

CGImageDestinationAddImage(destination, outputImage, nil)
guard CGImageDestinationFinalize(destination) else {
    fputs("failed to write output PNG\n", stderr)
    exit(7)
}
