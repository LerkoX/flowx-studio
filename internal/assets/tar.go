package assets

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// TarGz 将 srcDir 整个目录打包为 tar.gz 写入 dstPath。
// 包内路径形如 assets/nodes/...（保留 srcDir 基名）。srcDir 不存在时不创建 dst。
func TarGz(srcDir, dstPath string) (bool, error) {
	if _, err := os.Stat(srcDir); os.IsNotExist(err) {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(dstPath), 0755); err != nil {
		return false, err
	}
	out, err := os.Create(dstPath)
	if err != nil {
		return false, err
	}
	defer out.Close()
	gz := gzip.NewWriter(out)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()

	base := filepath.Base(srcDir)
	wrote := false
	err = filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(filepath.Join(base, rel))
		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		header.Name = name
		if err := tw.WriteHeader(header); err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		if !info.Mode().IsRegular() {
			return nil // 跳过符号链接/设备文件等
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		if _, err := io.Copy(tw, f); err != nil {
			return err
		}
		wrote = true
		return nil
	})
	if err != nil {
		os.Remove(dstPath)
		return false, err
	}
	return wrote, nil
}

// UntarGz 将 tar.gz 解包到 dstDir，带路径穿越防护。返回解压的文件数。
func UntarGz(srcPath, dstDir string) (int, error) {
	f, err := os.Open(srcPath)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return 0, fmt.Errorf("invalid gzip file: %w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)

	count := 0
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return count, fmt.Errorf("invalid tar stream: %w", err)
		}
		// 防路径穿越：解包目标必须落在 dstDir 内
		target := filepath.Join(dstDir, filepath.Clean(header.Name))
		cleanDst := filepath.Clean(dstDir) + string(filepath.Separator)
		if target != filepath.Clean(dstDir) && !strings.HasPrefix(target, cleanDst) {
			return count, fmt.Errorf("path traversal in archive: %s", header.Name)
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				return count, err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return count, err
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, os.FileMode(header.Mode)&0644|0644)
			if err != nil {
				return count, err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return count, err
			}
			out.Close()
			count++
		default:
			// 跳过符号链接等其他类型，避免逃逸 dstDir
		}
	}
	return count, nil
}
