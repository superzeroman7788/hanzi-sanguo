import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 3 else {
    fputs("usage: remove-light-background-color input.png output.png\n", stderr)
    exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let source = CGImageSourceCreateWithURL(inputURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { exit(3) }

let width = image.width
let height = image.height
let bytesPerRow = width * 4
var pixels = [UInt8](repeating: 0, count: height * bytesPerRow)
guard let context = CGContext(data: &pixels, width: width, height: height,
    bitsPerComponent: 8, bytesPerRow: bytesPerRow,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(4) }
context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

for offset in stride(from: 0, to: pixels.count, by: 4) {
    let red = Double(pixels[offset])
    let green = Double(pixels[offset + 1])
    let blue = Double(pixels[offset + 2])
    let luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
    let chroma = max(red, green, blue) - min(red, green, blue)

    // Remove the light neutral checkerboard while retaining pale celadon pigment.
    let lightAlpha = max(0, min(1, (236 - luminance) / 48))
    let colorAlpha = max(0, min(1, (chroma - 3) / 18))
    let alphaFactor = luminance >= 234 ? 0 : max(lightAlpha, colorAlpha)
    pixels[offset + 3] = UInt8(max(0, min(255, Double(pixels[offset + 3]) * alphaFactor)))
}

guard let outputImage = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(outputURL as CFURL,
        UTType.png.identifier as CFString, 1, nil) else { exit(5) }
CGImageDestinationAddImage(destination, outputImage, nil)
guard CGImageDestinationFinalize(destination) else { exit(6) }
