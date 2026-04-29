const FILE_URI_PREFIX = 'file://';

export function pathToUri(filePath: string): string {
  if (isFileUri(filePath)) {
    return filePath;
  }

  if (isWindowsPath(filePath)) {
    const normalized = filePath.replace(/\\/g, '/');
    return `${FILE_URI_PREFIX}/${encodePath(normalized)}`;
  }

  if (!filePath.startsWith('/')) {
    throw new Error('Expected an absolute file path');
  }

  return `${FILE_URI_PREFIX}${encodePath(filePath)}`;
}

export function uriToPath(uri: string): string {
  if (!isFileUri(uri)) {
    throw new Error('Expected a file URI');
  }

  const decoded = decodeURIComponent(uri.slice(FILE_URI_PREFIX.length));

  if (/^\/[A-Za-z]:\//.test(decoded)) {
    return decoded.slice(1).replace(/\//g, '\\');
  }

  return decoded;
}

function isFileUri(value: string): boolean {
  return value.startsWith(`${FILE_URI_PREFIX}/`);
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function encodePath(value: string): string {
  return value
    .split('/')
    .map((segment, index) => {
      const encoded = encodeURIComponent(segment);
      return index === 0 && /^[A-Za-z]:$/.test(segment) ? encoded.replace('%3A', ':') : encoded;
    })
    .join('/');
}
