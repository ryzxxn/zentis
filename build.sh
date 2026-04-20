#!/bin/bash
echo "Building Zentis..."
npm run build
if [ $? -eq 0 ]; then
    echo "Build successful!"
else
    echo "Build failed!"
    exit 1
fi
