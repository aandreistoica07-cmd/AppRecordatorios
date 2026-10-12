// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AlarmKitPlugin",
    platforms: [.iOS("26.0")],
    products: [
        .library(
            name: "AlarmKitPlugin",
            targets: ["AlarmKitPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "7.0.0")
    ],
    targets: [
        .target(
            name: "AlarmKitPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/AlarmKitPlugin")
    ]
)
