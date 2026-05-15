install_mysql_gem() {
  mysql_version=$(ls /opt/homebrew/Cellar/mysql)
  gem install mysql2 -- \
    --with-mysql-lib=/opt/homebrew/Cellar/mysql/$mysql_version/lib \
    --with-mysql-dir=/opt/homebrew/Cellar/mysql/$mysql_version \
    --with-mysql-config=/opt/homebrew/Cellar/mysql/$mysql_version/bin/mysql_config \
    --with-mysql-include=/opt/homebrew/Cellar/mysql/$mysql_version/include
}
